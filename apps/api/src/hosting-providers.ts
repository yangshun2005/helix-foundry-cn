import type {
  HostingProvider,
  HostingOptions,
  PlanetScaleToken,
} from "../../../packages/shared/src/index.js";
import { assert, AppError } from "./security.js";

export type HostingAuth = string | PlanetScaleToken;

export const hosting = {
  neon: {
    name: "Neon",
    authorize: "https://oauth2.neon.tech/oauth2/auth",
    token: "https://oauth2.neon.tech/oauth2/token",
    api: "https://console.neon.tech/api/v2",
    scopes: "openid offline offline_access urn:neoncloud:projects:read",
    pkce: true,
  },
  supabase: {
    name: "Supabase",
    authorize: "https://api.supabase.com/v1/oauth/authorize",
    token: "https://api.supabase.com/v1/oauth/token",
    api: "https://api.supabase.com/v1",
    scopes: "",
    pkce: true,
  },
  planetscale: {
    name: "PlanetScale",
    authorize: "https://auth.planetscale.com/oauth/authorize",
    token: "https://auth.planetscale.com/oauth/token",
    api: "https://api.planetscale.com/v1",
    scopes: "",
    pkce: false,
  },
} as const;
export function hostingCredentials(provider: HostingProvider) {
  return {
    clientId: process.env[provider.toUpperCase() + "_CLIENT_ID"] || "",
    clientSecret: process.env[provider.toUpperCase() + "_CLIENT_SECRET"] || "",
  };
}
async function jsonRequest(url: string, options: RequestInit) {
  let response: Response;
  try {
    response = await fetch(url, {
      ...options,
      redirect: "error",
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw new AppError(
      502,
      "The database provider could not be reached. Try again.",
    );
  }
  assert(
    response.ok,
    response.status === 401 || response.status === 403
      ? "The provider denied access. Reconnect and approve access to this database."
      : "The provider could not complete this request. Try again.",
    502,
  );
  try {
    return (await response.json()) as any;
  } catch {
    throw new AppError(502, "The provider returned an invalid response.");
  }
}
export async function exchangeHostingToken(
  provider: HostingProvider,
  parameters: Record<string, string>,
) {
  const credentials = hostingCredentials(provider);
  const body = new URLSearchParams(parameters);
  const headers: Record<string, string> = {
    "content-type": "application/x-www-form-urlencoded",
  };
  if (provider === "supabase")
    headers.authorization =
      "Basic " +
      Buffer.from(
        credentials.clientId + ":" + credentials.clientSecret,
      ).toString("base64");
  else {
    body.set("client_id", credentials.clientId);
    body.set("client_secret", credentials.clientSecret);
  }
  const result = await jsonRequest(hosting[provider].token, {
    method: "POST",
    headers,
    body,
  });
  assert(
    typeof result.access_token === "string" && result.access_token.length > 0,
    "The provider did not return an access token.",
    502,
  );
  return result;
}
const part = encodeURIComponent;
export function providerRequest(
  provider: HostingProvider,
  token: HostingAuth,
  path: string,
  body?: unknown,
) {
  assert(
    typeof token === "string" || provider === "planetscale",
    "Invalid provider credential.",
  );
  return jsonRequest(hosting[provider].api + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      authorization:
        typeof token === "string"
          ? "Bearer " + token
          : token.serviceTokenId + ":" + token.serviceToken,
      "content-type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
// Listings are bounded, but never silently truncated. Large accounts get a clear next step.
async function list(
  provider: HostingProvider,
  token: HostingAuth,
  path: string,
  key: string,
) {
  const items: any[] = [];
  let cursor: string | undefined;
  for (let page = 1; page <= 20; page++) {
    const query =
      provider === "neon"
        ? new URLSearchParams({ limit: "100", ...(cursor ? { cursor } : {}) })
        : new URLSearchParams({ per_page: "100", page: String(page) });
    const result = await providerRequest(provider, token, path + "?" + query);
    const rows = Array.isArray(result) ? result : result[key];
    assert(
      Array.isArray(rows),
      "The provider returned an invalid resource list.",
      502,
    );
    items.push(...rows);
    cursor = result.pagination?.next_cursor || result.pagination?.cursor;
    const more =
      provider === "neon"
        ? !!cursor && rows.length >= 100
        : !Array.isArray(result) &&
          (Number(result.next_page || 0) > page ||
            Number(result.total_pages || 1) > page);
    if (!more) return items;
  }
  throw new AppError(
    422,
    "This account has too many resources to list. Use a direct database connection.",
  );
}
const select = (items: any[], id: string, field = "id") => {
  const item = items.find((x) => x[field] === id);
  assert(item, "Choose a database from this provider account.", 404);
  return item;
};
export async function hostingOptions(
  provider: HostingProvider,
  token: HostingAuth,
  path: string[],
): Promise<HostingOptions> {
  if (provider === "supabase") {
    const projects = await list(provider, token, "/projects", "projects");
    if (!path.length)
      return {
        title: "Choose a project",
        options: projects.map((p) => ({ id: p.id, name: p.name })),
      };
    select(projects, path[0]);
    assert(path.length === 1, "Invalid project selection");
    return {
      title: "Connect your database",
      options: [],
      ready: true,
      needsPassword: true,
    };
  }
  if (provider === "neon") {
    const projects = await list(provider, token, "/projects", "projects");
    if (!path.length)
      return {
        title: "Choose a project",
        options: projects.map((p) => ({ id: p.id, name: p.name })),
      };
    select(projects, path[0]);
    const base = "/projects/" + part(path[0]);
    const branches = await list(
      provider,
      token,
      base + "/branches",
      "branches",
    );
    if (path.length === 1)
      return {
        title: "Choose a branch",
        options: branches.map((b) => ({
          id: b.id,
          name: b.name,
          description: b.default ? "Default branch" : undefined,
        })),
      };
    select(branches, path[1]);
    const databases = (
      await providerRequest(
        provider,
        token,
        base + "/branches/" + part(path[1]) + "/databases",
      )
    ).databases;
    assert(
      Array.isArray(databases),
      "The provider returned an invalid database list.",
      502,
    );
    if (path.length === 2)
      return {
        title: "Choose a database",
        options: databases.map((d: any) => ({ id: d.name, name: d.name })),
      };
    select(databases, path[2], "name");
    assert(path.length === 3, "Invalid database selection");
    return { title: "Connect your database", options: [], ready: true };
  }
  const organizations = await list(provider, token, "/organizations", "data");
  if (!path.length)
    return {
      title: "Choose an organization",
      options: organizations.map((o) => ({ id: o.name, name: o.name })),
    };
  select(organizations, path[0], "name");
  const base = "/organizations/" + part(path[0]) + "/databases";
  const databases = await list(provider, token, base, "data");
  if (path.length === 1)
    return {
      title: "Choose a database",
      options: databases.map((d) => ({ id: d.name, name: d.name })),
    };
  select(databases, path[1], "name");
  const branches = await list(
    provider,
    token,
    base + "/" + part(path[1]) + "/branches",
    "data",
  );
  if (path.length === 2)
    return {
      title: "Choose a branch",
      options: branches.map((b) => ({
        id: b.name,
        name: b.name,
        description: b.production ? "Production" : undefined,
      })),
    };
  select(branches, path[2], "name");
  assert(path.length === 3, "Invalid branch selection");
  return { title: "Connect your database", options: [], ready: true };
}

export async function resolveHostingDatabase(
  provider: HostingProvider,
  token: HostingAuth,
  path: string[],
  credentialName: string,
  password?: string,
): Promise<{
  name: string;
  kind: "postgres" | "mysql";
  config: Record<string, any>;
}> {
  const selection = await hostingOptions(provider, token, path);
  assert(selection.ready, "Choose a database first.");
  if (provider === "supabase") {
    assert(password?.length, "Enter this project's database password.");
    const project = await providerRequest(
      provider,
      token,
      "/projects/" + part(path[0]),
    );
    assert(
      typeof project.database?.host === "string",
      "This project does not have an available database.",
      422,
    );
    return {
      name: project.name,
      kind: "postgres",
      config: {
        host: project.database.host,
        port: 5432,
        database: "postgres",
        user: "postgres",
        password,
        tls: true,
      },
    };
  }
  if (provider === "neon") {
    const base = "/projects/" + part(path[0]);
    const dbs = (
      await providerRequest(
        provider,
        token,
        base + "/branches/" + part(path[1]) + "/databases",
      )
    ).databases;
    const db = select(dbs, path[2], "name");
    assert(
      db.owner_name,
      "The provider did not return the database role.",
      502,
    );
    const result = await providerRequest(
      provider,
      token,
      base +
        "/connection_uri?" +
        new URLSearchParams({
          branch_id: path[1],
          database_name: db.name,
          role_name: db.owner_name,
          pooled: "false",
        }),
    );
    const url = new URL(result.uri);
    assert(
      ["postgres:", "postgresql:"].includes(url.protocol) && url.hostname,
      "The provider returned an invalid database address.",
      502,
    );
    return {
      name: db.name,
      kind: "postgres",
      config: {
        host: url.hostname,
        port: Number(url.port || 5432),
        user: decodeURIComponent(url.username),
        password: decodeURIComponent(url.password),
        database: decodeURIComponent(url.pathname.slice(1)),
        tls: true,
        enableChannelBinding: true,
      },
    };
  }
  const base =
    "/organizations/" + part(path[0]) + "/databases/" + part(path[1]);
  const db = await providerRequest(provider, token, base);
  if (db.kind === "postgresql" || db.kind === "postgres") {
    const role = await providerRequest(
      provider,
      token,
      base + "/branches/" + part(path[2]) + "/roles",
      {
        name: credentialName,
        inherited_roles: ["pg_read_all_data"],
        with_replication: false,
      },
    );
    assert(
      role.access_host_url &&
        role.username &&
        role.password &&
        role.database_name,
      "The provider did not return database credentials.",
      502,
    );
    return {
      name: path[1],
      kind: "postgres",
      config: {
        host: role.access_host_url,
        port: 5432,
        user: role.username,
        password: role.password,
        database: role.database_name,
        tls: true,
      },
    };
  }
  assert(
    db.kind === "mysql" || db.kind === "vitess",
    "This PlanetScale database engine is not supported. Use a direct connection.",
    422,
  );
  const credential = await providerRequest(
    provider,
    token,
    base + "/branches/" + part(path[2]) + "/passwords",
    { name: credentialName, role: "reader" },
  );
  assert(
    credential.access_host_url && credential.username && credential.plain_text,
    "The provider did not return database credentials.",
    502,
  );
  assert(
    credential.role === "reader",
    "The provider did not grant a read-only connection. Check the integration permissions.",
    422,
  );
  return {
    name: path[1],
    kind: "mysql",
    config: {
      host: credential.access_host_url,
      port: 3306,
      user: credential.username,
      password: credential.plain_text,
      database: path[1],
      tls: true,
    },
  };
}
