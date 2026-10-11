import type { PoolConfig } from "pg";
import { assert, AppError } from "./security.js";

export function postgresPoolConfig(c: Record<string, any>): PoolConfig {
  let host = c.host,
    port = Number(c.port || 5432),
    user = c.user,
    password = c.password,
    database = c.database,
    tls = !!c.tls;
  let applicationName: string | undefined;
  if (c.connectionString !== undefined) {
    let url: URL;
    try {
      url = new URL(String(c.connectionString).trim());
      host = decodeURIComponent(url.hostname).replace(/^\[|\]$/g, "");
      user = decodeURIComponent(url.username);
      password = decodeURIComponent(url.password);
      database = decodeURIComponent(url.pathname.slice(1));
      port = Number(url.port || 5432);
    } catch {
      throw new AppError(400, "Enter a valid PostgreSQL connection URL.");
    }
    assert(
      ["postgres:", "postgresql:"].includes(url.protocol),
      "Use a PostgreSQL connection URL.",
    );
    assert(
      host && !host.includes("/") && user && database && !url.hash,
      "The connection URL must include a server, username, and database. Encode special characters in credentials.",
    );
    // Parse only supported options; pg's general URL parser can read local certificate files.
    assert(
      [...url.searchParams.keys()].every((key) =>
        ["sslmode", "ssl", "application_name"].includes(key),
      ),
      "This connection URL contains unsupported options. Use Connection options for custom TLS certificates.",
    );
    const mode = url.searchParams.get("sslmode");
    assert(
      mode === null ||
        ["disable", "require", "verify-ca", "verify-full", "prefer"].includes(
          mode,
        ),
      "Use sslmode=require, verify-full, or disable. TLS connections always verify certificates.",
    );
    const ssl = url.searchParams.get("ssl");
    assert(
      ssl === null || ["true", "false", "1", "0"].includes(ssl),
      "Use true or false for the URL’s ssl option.",
    );
    tls =
      c.tls !== undefined
        ? !!c.tls
        : mode !== null
          ? mode !== "disable"
          : ssl !== null
            ? ["true", "1"].includes(ssl)
            : true;
    applicationName = url.searchParams.get("application_name") || undefined;
  }
  return {
    host,
    port,
    user,
    password,
    database,
    application_name: applicationName,
    enableChannelBinding: !!c.enableChannelBinding,
    max: 2,
    connectionTimeoutMillis: 10000,
    ssl: tls
      ? { rejectUnauthorized: true, ...(c.ca ? { ca: c.ca } : {}) }
      : false,
  };
}
