import { it, expect, vi, beforeEach, afterEach } from "vitest";
import { createApp } from "../apps/api/src/app.js";
import { MemoryStore, transaction } from "../apps/api/src/store.js";
import { seal, unseal } from "../apps/api/src/security.js";
import {
  hostingOptions,
  resolveHostingDatabase,
} from "../apps/api/src/hosting-providers.js";
vi.mock("../apps/api/src/connectors.js", () => ({
  discover: vi.fn(async () => ({
    tables: [{ name: "orders", schema: "public" }],
    columns: [],
    keys: [],
  })),
}));
let store: MemoryStore,
  app: Awaited<ReturnType<typeof createApp>>,
  scope: string;
beforeEach(async () => {
  vi.stubEnv("NEON_CLIENT_ID", "neon-client");
  vi.stubEnv("NEON_CLIENT_SECRET", "private-client");
  vi.stubEnv("SUPABASE_CLIENT_ID", "supabase-client");
  vi.stubEnv("SUPABASE_CLIENT_SECRET", "private-client");
  vi.stubEnv("PLANETSCALE_CLIENT_ID", "planetscale-client");
  vi.stubEnv("PLANETSCALE_CLIENT_SECRET", "private-client");
  store = new MemoryStore();
  app = await createApp(store);
  const me = (await app.inject({ method: "GET", url: "/api/v1/me" })).json();
  scope = me.workspaces[0].id;
});
afterEach(async () => {
  await app.close();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
const post = (
  path: string,
  payload: unknown = {},
  headers: Record<string, string> = {},
) =>
  app.inject({
    method: "POST",
    url: `/api/v1/workspaces/${scope}` + path,
    headers,
    payload: payload as any,
  });
const json = (data: any, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
function neonFetch() {
  return vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/token"))
      return json({
        access_token: "private-access-token",
        refresh_token: "private-refresh-token",
        expires_in: 3600,
      });
    expect((init?.headers as any).authorization).toBe(
      "Bearer private-access-token",
    );
    if (url.pathname.endsWith("/projects"))
      return json({ projects: [{ id: "project", name: "Acme" }] });
    if (url.pathname.endsWith("/branches"))
      return json({
        branches: [{ id: "branch", name: "main", default: true }],
      });
    if (url.pathname.endsWith("/databases"))
      return json({ databases: [{ name: "business", owner_name: "reader" }] });
    if (url.pathname.endsWith("/connection_uri"))
      return json({
        uri: "postgresql://reader:private-password@db.example/business?sslmode=require&channel_binding=require",
      });
    throw new Error("Unexpected provider request " + url.pathname);
  });
}
async function connectNeon() {
  const start = await post("/hosting/neon/authorize");
  expect(start.statusCode).toBe(200);
  const url = new URL(start.json().url);
  expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  expect(start.body).not.toContain("private-client");
  const callback = new URL(url.searchParams.get("redirect_uri")!);
  callback.search = new URLSearchParams({
    state: url.searchParams.get("state")!,
    code: "provider-code",
  }).toString();
  const cookies = { [start.cookies[0].name]: start.cookies[0].value };
  const rejected = await app.inject({
    method: "GET",
    url: callback.pathname + callback.search,
  });
  expect(rejected.statusCode).toBe(400);
  const result = await app.inject({
    method: "GET",
    url: callback.pathname + callback.search,
    cookies,
  });
  expect(result.statusCode).toBe(302);
  expect(result.headers.location).not.toContain("provider-code");
  const replay = await app.inject({
    method: "GET",
    url: callback.pathname + callback.search,
    cookies,
  });
  expect(replay.statusCode).toBe(400);
  return new URL(result.headers.location!).searchParams.get("account")!;
}

it("binds OAuth to browser, workspace, session and owner; keeps database secrets server-side through import", async () => {
  const fetch = neonFetch();
  vi.stubGlobal("fetch", fetch);
  const accountId = await connectNeon();
  const account = await store.get(scope, accountId);
  expect(JSON.stringify(account)).not.toContain("private-access-token");
  expect(unseal(account!.data.secret).access_token).toBe(
    "private-access-token",
  );
  const selection = { accountId, path: ["project", "branch", "business"] };
  expect((await post("/hosting/neon/options", selection)).json().ready).toBe(
    true,
  );
  const connected = await post("/hosting/neon/connect", selection);
  expect(connected.statusCode, connected.body).toBe(200);
  expect(connected.body).not.toContain("private-password");
  const connection = connected.json();
  expect(connection.config).toEqual({ hostedConnectionId: connection.id });
  const imported = await post("/onboarding/sources", {
    name: "Business",
    kind: "postgres",
    config: connection.config,
    selections: [{ schema: "public", table: "orders" }],
    operationId: "provider-import-1",
  });
  expect(imported.statusCode, imported.body).toBe(200);
  const source = (await store.list(scope, "source"))[0];
  expect(source.data.hostedProvider).toBe("neon");
  expect(unseal(source.data.secret)).toMatchObject({
    host: "db.example",
    user: "reader",
    table: "orders",
    tls: true,
  });
  expect(imported.body).not.toContain("private-password");
  const other = await app.inject({
    method: "POST",
    url: "/api/v1/workspaces",
    payload: { name: "Other" },
  });
  const otherScope = other.json().id;
  const foreign = await app.inject({
    method: "POST",
    url: `/api/v1/workspaces/${otherScope}/sources/test`,
    payload: { name: "Foreign", kind: "postgres", config: connection.config },
  });
  expect(foreign.statusCode).toBe(404);
  expect(
    (
      await post("/sources/test", {
        name: "Override",
        kind: "postgres",
        config: { ...connection.config, host: "other.example" },
      })
    ).statusCode,
  ).toBe(400);
  // Provider sign-in belongs to the person at this computer, not to scripts.
  const { token } = (
    await post("/tokens", { name: "Script", readOnly: false })
  ).json();
  const bearer = { authorization: `Bearer ${token}` };
  expect((await post("/hosting/neon/authorize", {}, bearer)).statusCode).toBe(
    403,
  );
});

it("handles denial, missing integration configuration and token refresh without leaking provider responses", async () => {
  vi.stubEnv("NEON_CLIENT_ID", "");
  expect((await post("/hosting/neon/authorize")).statusCode).toBe(503);
  vi.stubEnv("NEON_CLIENT_ID", "neon-client");
  vi.stubGlobal("fetch", neonFetch());
  const accountId = await connectNeon(),
    account = (await store.get(scope, accountId))!;
  await transaction(store, scope, async (tx) => {
    tx.update(account, {
      ...account.data,
      secret: seal({
        ...unseal<Record<string, unknown>>(account.data.secret),
        expiresAt: 1,
      }),
    });
  });
  expect(
    (await post("/hosting/neon/options", { accountId, path: [] })).statusCode,
  ).toBe(200);
  const secret = unseal((await store.get(scope, accountId))!.data.secret);
  expect(secret.expiresAt).toBeGreaterThan(Date.now());
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => json({ message: "private-provider-detail" }, 403)),
  );
  const denied = await post("/hosting/neon/options", { accountId, path: [] });
  expect(denied.statusCode).toBe(502);
  expect(denied.body).not.toContain("private-provider-detail");
});

it("validates personal tokens and Supabase project access before requesting its database password", async () => {
  const fetch = vi.fn(async (input: string | URL) =>
    String(input).includes("/projects/ref")
      ? json({
          id: "ref",
          name: "Supabase project",
          database: { host: "db.ref.supabase.co" },
        })
      : json([{ id: "ref", name: "Supabase project" }]),
  );
  vi.stubGlobal("fetch", fetch);
  const auth = await post("/hosting/supabase/token", {
    apiKey: "supabase-private-token",
  });
  expect(auth.statusCode).toBe(200);
  expect(auth.body).not.toContain("supabase-private-token");
  const selection = { accountId: auth.json().account.id, path: ["ref"] };
  expect(
    (await post("/hosting/supabase/options", selection)).json().needsPassword,
  ).toBe(true);
  expect((await post("/hosting/supabase/connect", selection)).statusCode).toBe(
    400,
  );
  expect(
    (
      await post("/hosting/supabase/connect", {
        ...selection,
        password: "private-password",
      })
    ).statusCode,
  ).toBe(200);
  expect(
    (
      await post("/hosting/supabase/options", {
        ...selection,
        path: ["other-project"],
      })
    ).statusCode,
  ).toBe(404);
});

it("creates read-only PlanetScale credentials and refuses unexpected privileges", async () => {
  let role = "reader";
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL, init?: RequestInit) => {
      const p = new URL(String(input)).pathname;
      if (p.endsWith("/organizations"))
        return json({ data: [{ name: "acme" }], total_pages: 1 });
      if (p.endsWith("/databases"))
        return json({
          data: [{ name: "shop", kind: "mysql" }],
          total_pages: 1,
        });
      if (p.endsWith("/branches"))
        return json({
          data: [{ name: "main", production: true }],
          total_pages: 1,
        });
      if (p.endsWith("/shop")) return json({ kind: "mysql" });
      if (p.endsWith("/passwords")) {
        expect(JSON.parse(String(init?.body)).role).toBe("reader");
        return json({
          role,
          access_host_url: "db.psdb.cloud",
          username: "reader",
          plain_text: "private-password",
        });
      }
      throw new Error("Unexpected provider request");
    }),
  );
  const path = ["acme", "shop", "main"];
  const result = await resolveHostingDatabase(
    "planetscale",
    "token",
    path,
    "Helix Foundry test",
  );
  expect(result.kind).toBe("mysql");
  expect(result.config.tls).toBe(true);
  role = "admin";
  await expect(
    resolveHostingDatabase("planetscale", "token", path, "Helix Foundry test"),
  ).rejects.toThrow("read-only");
});

it("connects PlanetScale service tokens without OAuth, scopes discovery and keeps credentials encrypted", async () => {
  vi.stubEnv("PLANETSCALE_CLIENT_ID", "");
  vi.stubEnv("PLANETSCALE_CLIENT_SECRET", "");
  const credentials = {
    serviceTokenId: "service-id",
    serviceToken: "private-service-token",
  };
  const fetch = vi.fn(async (input: string | URL, init?: RequestInit) => {
    expect((init?.headers as any).authorization).toBe(
      "service-id:private-service-token",
    );
    const p = new URL(String(input)).pathname;
    if (p.endsWith("/organizations"))
      return json({ data: [{ name: "acme" }], next_page: null });
    if (p.endsWith("/databases"))
      return json({ data: [{ name: "shop", kind: "mysql" }], next_page: null });
    if (p.endsWith("/branches"))
      return json({
        data: [{ name: "main", production: true }],
        next_page: null,
      });
    if (p.endsWith("/shop")) return json({ kind: "mysql" });
    if (p.endsWith("/passwords")) {
      expect(JSON.parse(String(init?.body)).role).toBe("reader");
      return json({
        role: "reader",
        access_host_url: "db.psdb.cloud",
        username: "reader",
        plain_text: "private-db-password",
      });
    }
    throw new Error("Unexpected provider request");
  });
  vi.stubGlobal("fetch", fetch);
  expect(
    (
      await post("/hosting/planetscale/token", {
        apiKey: "not-a-service-token",
      })
    ).statusCode,
  ).toBe(400);
  expect((await post("/hosting/neon/token", credentials)).statusCode).toBe(400);
  expect(
    (
      await post("/hosting/planetscale/token", {
        ...credentials,
        serviceTokenId: "invalid:header",
      })
    ).statusCode,
  ).toBe(400);
  expect(fetch).not.toHaveBeenCalled();
  const response = await post("/hosting/planetscale/token", credentials);
  expect(response.statusCode, response.body).toBe(200);
  expect(response.body).not.toContain("private-service-token");
  const accountId = response.json().account.id;
  const account = (await store.get(scope, accountId))!;
  expect(JSON.stringify(account)).not.toContain("private-service-token");
  expect(unseal(account.data.secret)).toEqual(credentials);
  const selection = { accountId, path: ["acme", "shop", "main"] };
  expect(
    (await post("/hosting/planetscale/options", selection)).json().ready,
  ).toBe(true);
  expect(
    (
      await post("/hosting/planetscale/options", {
        accountId,
        path: ["foreign"],
      })
    ).statusCode,
  ).toBe(404);
  const connected = await post("/hosting/planetscale/connect", selection);
  expect(connected.statusCode, connected.body).toBe(200);
  expect(connected.body).not.toContain("private-db-password");
  expect(
    unseal((await store.get(scope, connected.json().id))!.data.secret),
  ).toMatchObject({ user: "reader", tls: true });
  const { token } = (
    await post("/tokens", { name: "Reader", readOnly: true })
  ).json();
  expect(
    (
      await post("/hosting/planetscale/token", credentials, {
        authorization: `Bearer ${token}`,
      })
    ).statusCode,
  ).toBe(403);
});

it("does not retain rejected service tokens and sanitizes provider errors", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => json({ message: "private-service-token rejected" }, 401)),
  );
  const denied = await post("/hosting/planetscale/token", {
    serviceTokenId: "service-id",
    serviceToken: "private-service-token",
  });
  expect(denied.statusCode).toBe(502);
  expect(denied.body).not.toContain("private-service-token");
  expect(await store.list(scope, "hostedAccount")).toHaveLength(0);
});

it("follows PlanetScale next_page pagination with service-token authentication", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL) => {
      const page = new URL(String(input)).searchParams.get("page");
      return json({
        data: [{ name: page === "1" ? "acme" : "other" }],
        next_page: page === "1" ? 2 : null,
      });
    }),
  );
  const result = await hostingOptions(
    "planetscale",
    { serviceTokenId: "id", serviceToken: "token" },
    [],
  );
  expect(result.options.map((o) => o.id)).toEqual(["acme", "other"]);
});

it("follows provider pagination so project selection never silently excludes later projects", async () => {
  const fetch = vi.fn(async (input: string | URL) =>
    new URL(String(input)).searchParams.get("cursor")
      ? json({ projects: [{ id: "last", name: "Last" }] })
      : json({
          projects: Array.from({ length: 100 }, (_, i) => ({
            id: String(i),
            name: "Project " + i,
          })),
          pagination: { cursor: "page-two" },
        }),
  );
  vi.stubGlobal("fetch", fetch);
  const result = await hostingOptions("neon", "token", []);
  expect(result.options).toHaveLength(101);
  expect(fetch).toHaveBeenCalledTimes(2);
});
