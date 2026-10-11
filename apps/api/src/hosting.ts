import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import {
  hostingProviders,
  HostingProviderSchema,
  HostingSelectionSchema,
  HostingTokenSchema,
  type HostingProvider,
} from "../../../packages/shared/src/index.js";
import {
  hosting,
  hostingCredentials,
  exchangeHostingToken,
  hostingOptions,
  resolveHostingDatabase,
  type HostingAuth,
} from "./hosting-providers.js";
import { type Store, transaction, resource } from "./store.js";
import { assert, AppError, token, digest, seal, unseal } from "./security.js";
import { config } from "./config.js";
import { discover } from "./connectors.js";

type Access = (req: any, role?: "owner" | "editor" | "viewer") => Promise<any>;
const callbackURL = (scope: string, provider: string) =>
  config.origin +
  "/api/v1/workspaces/" +
  encodeURIComponent(scope) +
  "/hosting/" +
  provider +
  "/callback";
const cookieName = (provider: string) => "foundry_connect_" + provider;

export async function resolveHostedConfig(
  store: Store,
  scope: string,
  kind: string,
  input: Record<string, any>,
) {
  if (!input.hostedConnectionId)
    return {
      config: input,
      provider: undefined as HostingProvider | undefined,
    };
  const connection = await store.get(scope, input.hostedConnectionId);
  assert(
    connection?.kind === "hostedCredential" &&
      connection.data.kind === kind &&
      connection.data.secret,
    "Database connection not found in this workspace.",
    404,
  );
  assert(
    Object.keys(input).every((k) =>
      ["hostedConnectionId", "schema", "table"].includes(k),
    ),
    "Provider connection details cannot be overridden.",
  );
  return {
    config: {
      ...unseal(connection.data.secret),
      ...(input.schema ? { schema: input.schema } : {}),
      ...(input.table ? { table: input.table } : {}),
    },
    provider: connection.data.provider as HostingProvider,
  };
}

export function registerHosting(
  app: FastifyInstance,
  store: Store,
  access: Access,
) {
  const base = "/api/v1/workspaces/:w/hosting";
  const refreshes = new Map<string, Promise<string>>();
  async function accessToken(
    scope: string,
    provider: HostingProvider,
    id: string,
  ): Promise<HostingAuth> {
    const account = await store.get(scope, id);
    assert(
      account?.kind === "hostedAccount" && account.data.provider === provider,
      "Provider account not found in this workspace.",
      404,
    );
    const secret = unseal(account.data.secret);
    if (
      provider === "planetscale" &&
      secret.serviceTokenId &&
      secret.serviceToken
    )
      return {
        serviceTokenId: secret.serviceTokenId,
        serviceToken: secret.serviceToken,
      };
    if (!secret.expiresAt || secret.expiresAt > Date.now() + 60000)
      return secret.access_token;
    assert(
      secret.refresh_token,
      "Reconnect your provider account to continue.",
      409,
    );
    const key = scope + ":" + id;
    if (refreshes.has(key)) return refreshes.get(key)!;
    const refreshing = (async () => {
      const next = await exchangeHostingToken(provider, {
        grant_type: "refresh_token",
        refresh_token: secret.refresh_token,
      });
      await transaction(store, scope, async (tx) => {
        const current = await tx.get(id);
        assert(
          current?.kind === "hostedAccount",
          "Provider account was disconnected.",
          409,
        );
        tx.update(current, {
          ...current.data,
          secret: seal({
            ...secret,
            ...next,
            expiresAt: next.expires_in
              ? Date.now() + Number(next.expires_in) * 1000
              : null,
          }),
        });
      });
      return next.access_token;
    })();
    refreshes.set(key, refreshing);
    try {
      return await refreshing;
    } finally {
      refreshes.delete(key);
    }
  }
  app.get(base, async (req) => {
    const a = await access(req);
    const accounts = await store.list(a.scope, "hostedAccount");
    return hostingProviders.map((provider) => ({
      provider,
      name: hosting[provider].name,
      configured: !!(
        hostingCredentials(provider).clientId &&
        hostingCredentials(provider).clientSecret
      ),
      accounts: accounts
        .filter((r) => r.data.provider === provider)
        .map((r) => ({ id: r.id, name: r.name })),
    }));
  });
  app.post(base + "/:provider/authorize", async (req: any, reply) => {
    const a = await access(req, "owner"),
      provider = HostingProviderSchema.parse(req.params.provider);
    assert(
      a.session.kind === "session",
      "Connect a provider from the browser; API tokens can't start provider sign-in.",
      403,
    );
    const credentials = hostingCredentials(provider);
    const { returnTo } = z
      .object({
        returnTo: z.enum(["onboarding", "sources"]).default("onboarding"),
      })
      .parse(req.body || {});
    assert(
      credentials.clientId && credentials.clientSecret,
      "Provider sign-in is not configured for this installation. Use a direct connection or ask the installation administrator to enable it.",
      503,
    );
    const state = token(),
      browser = token(),
      verifier = token();
    await transaction(store, a.scope, async (tx) => {
      for (const old of await tx.list("hostingAuth"))
        if (old.data.expiresAt < Date.now()) tx.delete(old.id);
      tx.put(
        resource(
          a.scope,
          "hostingAuth",
          "Connect " + hosting[provider].name,
          {
            provider,
            returnTo,
            browser: digest(browser),
            sessionId: a.session.id,
            actor: a.user.id,
            expiresAt: Date.now() + 600000,
            secret: seal({ verifier }),
            consumed: false,
          },
          digest(state),
        ),
      );
    });
    reply
      .header("cache-control", "no-store")
      .setCookie(cookieName(provider), browser, {
        path:
          "/api/v1/workspaces/" +
          a.scope +
          "/hosting/" +
          provider +
          "/callback",
        httpOnly: true,
        sameSite: "lax",
        secure: config.origin.startsWith("https:"),
        maxAge: 600,
      });
    const url = new URL(hosting[provider].authorize);
    url.search = new URLSearchParams({
      client_id: credentials.clientId,
      redirect_uri: callbackURL(a.scope, provider),
      response_type: "code",
      state,
      ...(hosting[provider].scopes ? { scope: hosting[provider].scopes } : {}),
      ...(hosting[provider].pkce
        ? {
            code_challenge: Buffer.from(digest(verifier), "hex").toString(
              "base64url",
            ),
            code_challenge_method: "S256",
          }
        : {}),
    }).toString();
    return { url: url.toString() };
  });
  app.get(base + "/:provider/callback", async (req: any, reply) => {
    const provider = HostingProviderSchema.parse(req.params.provider),
      scope = z.string().max(100).parse(req.params.w);
    reply
      .header("cache-control", "no-store")
      .header("referrer-policy", "no-referrer");
    const query = z
      .object({
        state: z.string().min(20).max(200),
        code: z.string().max(2000).optional(),
        error: z.string().max(200).optional(),
      })
      .parse(req.query);
    const flow = await transaction(store, scope, async (tx) => {
      const f = await tx.get(digest(query.state));
      assert(
        f?.kind === "hostingAuth" &&
          f.data.provider === provider &&
          f.data.expiresAt > Date.now() &&
          !f.data.consumed &&
          f.data.browser === digest(req.cookies[cookieName(provider)] || ""),
        "This connection request expired. Start again.",
        400,
      );
      const session = await store.get("global", f.data.sessionId),
        member = await store.get("global", `${f.data.actor}:${scope}`);
      assert(
        session?.kind === "session" &&
          session.data.userId === f.data.actor &&
          session.data.expiresAt > Date.now() &&
          member?.data.role === "owner",
        "Your connection permission is no longer available.",
        403,
      );
      tx.update(f, { ...f.data, consumed: true });
      return f;
    });
    reply.clearCookie(cookieName(provider), {
      path:
        "/api/v1/workspaces/" + scope + "/hosting/" + provider + "/callback",
    });
    const destination = new URL(
      flow.data.returnTo === "sources" ? "/sources?add=1" : "/onboarding",
      config.origin,
    );
    destination.searchParams.set("hosting", provider);
    destination.searchParams.set("workspace", scope);
    if (query.error || !query.code) {
      destination.searchParams.set(
        "hosting_error",
        "Access was not approved. You can try again or connect directly.",
      );
      return reply.redirect(destination.toString());
    }
    try {
      const result = await exchangeHostingToken(provider, {
        grant_type: "authorization_code",
        code: query.code,
        redirect_uri: callbackURL(scope, provider),
        ...(hosting[provider].pkce
          ? { code_verifier: unseal(flow.data.secret).verifier }
          : {}),
      });
      const account = resource(scope, "hostedAccount", hosting[provider].name, {
        provider,
        actor: flow.data.actor,
        secret: seal({
          ...result,
          expiresAt: result.expires_in
            ? Date.now() + Number(result.expires_in) * 1000
            : null,
        }),
      });
      await transaction(store, scope, async (tx) => {
        tx.put(account);
      });
      destination.searchParams.set("account", account.id);
    } catch {
      destination.searchParams.set(
        "hosting_error",
        "Provider sign-in could not be completed. Please try again.",
      );
    }
    return reply.redirect(destination.toString());
  });
  app.post(base + "/:provider/options", async (req: any) => {
    const a = await access(req, "owner"),
      provider = HostingProviderSchema.parse(req.params.provider),
      body = HostingSelectionSchema.parse(req.body);
    return hostingOptions(
      provider,
      await accessToken(a.scope, provider, body.accountId),
      body.path,
    );
  });
  app.post(base + "/:provider/token", async (req: any) => {
    const a = await access(req, "owner"),
      provider = HostingProviderSchema.parse(req.params.provider);
    const body = HostingTokenSchema.parse(req.body);
    assert(
      provider === "planetscale" ? "serviceTokenId" in body : "apiKey" in body,
      provider === "planetscale"
        ? "Enter the service token ID and token."
        : "Enter the provider API key.",
    );
    const auth = "apiKey" in body ? body.apiKey : body;
    const options = await hostingOptions(provider, auth, []);
    const account = resource(a.scope, "hostedAccount", hosting[provider].name, {
      provider,
      actor: a.user.id,
      secret: seal(typeof auth === "string" ? { access_token: auth } : auth),
    });
    await transaction(store, a.scope, async (tx) => {
      tx.put(account);
    });
    return { account: { id: account.id, name: account.name }, options };
  });
  app.post(base + "/:provider/connect", async (req: any) => {
    const a = await access(req, "owner"),
      provider = HostingProviderSchema.parse(req.params.provider),
      body = HostingSelectionSchema.parse(req.body);
    const authToken = await accessToken(a.scope, provider, body.accountId);
    const id =
      "hosted_" +
      digest(
        JSON.stringify([
          provider,
          body.accountId,
          body.path,
          body.password || "",
        ]),
      );
    let connection = await store.get(a.scope, id);
    if (!connection?.data.secret) {
      const claim = randomUUID();
      await transaction(store, a.scope, async (tx) => {
        const current = await tx.get(id);
        assert(
          !current?.data.secret && !(current?.data.leaseUntil > Date.now()),
          "Connection is already being prepared. Try again shortly.",
          409,
        );
        tx.put(
          resource(
            a.scope,
            "hostedCredential",
            hosting[provider].name,
            {
              provider,
              accountId: body.accountId,
              claim,
              leaseUntil: Date.now() + 60000,
            },
            id,
          ),
        );
      });
      try {
        const resolved = await resolveHostingDatabase(
          provider,
          authToken,
          body.path,
          "Helix Foundry " + id.slice(-12),
          body.password,
        );
        connection = await transaction(store, a.scope, async (tx) => {
          const current = (await tx.get(id))!;
          assert(
            current.data.claim === claim,
            "Connection preparation changed. Retry.",
            409,
          );
          return tx.put({
            ...current,
            name: resolved.name,
            data: {
              provider,
              accountId: body.accountId,
              kind: resolved.kind,
              secret: seal(resolved.config),
            },
          });
        });
      } catch (error) {
        await transaction(store, a.scope, async (tx) => {
          const current = await tx.get(id);
          if (current?.data.claim === claim)
            tx.update(current, { ...current.data, leaseUntil: 0 });
        });
        throw error;
      }
    }
    let discovery;
    try {
      discovery = await discover(
        connection.data.kind,
        unseal(connection.data.secret),
      );
    } catch {
      throw new AppError(
        400,
        "The database could not be reached with the approved credentials. Check that this installation can reach it and that access is allowed.",
      );
    }
    return {
      id,
      name: connection.name,
      kind: connection.data.kind,
      config: { hostedConnectionId: id },
      discovery,
    };
  });
}
