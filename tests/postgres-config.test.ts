import { it, expect } from "vitest";
import { postgresPoolConfig } from "../apps/api/src/postgres-config.js";
import { redact } from "../apps/api/src/security.js";

it("reads encoded PostgreSQL URL credentials and requires verified TLS by default", () => {
  const c = postgresPoolConfig({
    connectionString:
      "postgresql://a%40b:p%3A%2F%40ss@db.example:5433/my%20data",
  });
  expect(c).toMatchObject({
    host: "db.example",
    port: 5433,
    user: "a@b",
    password: "p:/@ss",
    database: "my data",
    ssl: { rejectUnauthorized: true },
  });
  expect(
    postgresPoolConfig({
      connectionString: "postgres://u:p@localhost/db?sslmode=disable",
    }).ssl,
  ).toBe(false);
  expect(
    postgresPoolConfig({
      connectionString: "postgres://u:p@[::1]/db",
      tls: false,
    }).host,
  ).toBe("::1");
});

it("keeps individual fields compatible and rejects unsafe URL options without exposing secrets", () => {
  expect(
    postgresPoolConfig({
      host: "db",
      user: "u",
      password: "p",
      database: "d",
      tls: true,
      ca: "certificate",
    }).ssl,
  ).toEqual({ rejectUnauthorized: true, ca: "certificate" });
  for (const connectionString of [
    "mysql://u:private@db/d",
    "postgres://u:private@db/d?sslrootcert=/etc/passwd",
    "postgres://u:private@db/d?sslmode=no-verify",
    "postgres://u:private@db",
  ]) {
    expect(() => postgresPoolConfig({ connectionString })).toThrow();
    try {
      postgresPoolConfig({ connectionString });
    } catch (e) {
      expect(String(e)).not.toContain("private");
    }
  }
  expect(
    redact("Failed postgres://user:private@db.example/data"),
  ).not.toContain("private");
});
