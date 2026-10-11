import { it, expect, vi } from "vitest";
import pg from "pg";
import mysql from "mysql2/promise";
import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { execute as localExecute } from "../services/executor/src/engine.js";
vi.mock("../apps/api/src/executor.js", () => ({
  execute: (job: any) => localExecute(job),
}));
import { MemoryStore } from "../apps/api/src/store.js";
import { createApp } from "../apps/api/src/app.js";
import { startWorker } from "../apps/api/src/jobs.js";
import { onboardingState } from "../apps/api/src/onboarding-state.js";
import { config } from "../apps/api/src/config.js";
it
  .skipIf(process.env.TEST_ONBOARDING_DATABASES !== "1")
  .each(["mysql", "postgres"])(
  "imports selected %s tables completely and stages schema drift",
  async (kind) => {
    const connection = {
      host: "127.0.0.1",
      port: kind === "mysql" ? 33077 : 54877,
      database: "foundry_test",
      user: kind === "mysql" ? "root" : "postgres",
      password: "foundry-test-only",
    };
    const db =
      kind === "mysql"
        ? await mysql.createConnection(connection)
        : new pg.Client(connection);
    if (kind === "postgres") await (db as pg.Client).connect();
    const sql = async (statement: string) => {
      if (kind === "mysql")
        await (db as Awaited<ReturnType<typeof mysql.createConnection>>).query(
          statement,
        );
      else await (db as pg.Client).query(statement);
    };
    const store = new MemoryStore(),
      app = await createApp(store);
    let scope = "",
      stop = () => {};
    try {
      await sql("DROP TABLE IF EXISTS setup_orders");
      await sql("DROP TABLE IF EXISTS setup_customers");
      await sql("DROP TABLE IF EXISTS setup_unselected");
      await sql(
        "CREATE TABLE setup_customers (id INT PRIMARY KEY, name VARCHAR(100))",
      );
      await sql(
        "CREATE TABLE setup_orders (id INT PRIMARY KEY, customer INT REFERENCES setup_customers(id), amount DECIMAL(20,4))",
      );
      await sql("CREATE TABLE setup_unselected (id INT PRIMARY KEY)");
      await sql("INSERT INTO setup_customers VALUES (1,'東京 café')");
      await sql(
        "INSERT INTO setup_orders VALUES " +
          Array.from({ length: 125 }, (_, i) => `(${i + 1},1,123.4500)`).join(
            ",",
          ),
      );
      const me = await app.inject({ method: "GET", url: "/api/v1/me" });
      expect(me.statusCode).toBe(200);
      scope = me.json().workspaces[0].id;
      const post = async (path: string, payload: unknown) =>
        app.inject({
          method: "POST",
          url: `/api/v1/workspaces/${scope}` + path,
          payload: payload as any,
        });
      const bad = await post("/onboarding/sources", {
        name: "Database",
        kind,
        config: { ...connection, password: "incorrect-password" },
        selections: [{ table: "setup_customers" }],
        operationId: "wrong-authentication",
      });
      expect(bad.statusCode).toBe(400);
      expect(bad.body).toContain("Authentication failed");
      expect(await store.list(scope, "source")).toHaveLength(0);
      const tls = await post("/onboarding/sources", {
        name: "Database",
        kind,
        config: { ...connection, tls: true },
        selections: [{ table: "setup_customers" }],
        operationId: "tls-verification",
      });
      expect(tls.statusCode).toBe(400);
      expect(tls.body).toContain("TLS verification failed");
      const request = {
        name: "Database",
        kind,
        config: connection,
        selections: [
          {
            table: "setup_customers",
            ...(kind === "postgres" ? { schema: "public" } : {}),
          },
          {
            table: "setup_orders",
            ...(kind === "postgres" ? { schema: "public" } : {}),
          },
        ],
        operationId: "multi-table-connection",
      };
      const created = await post("/onboarding/sources", request);
      expect(created.statusCode, created.body).toBe(200);
      expect((await post("/onboarding/sources", request)).json()).toEqual(
        created.json(),
      );
      stop = startWorker(store);
      await expect
        .poll(async () => (await onboardingState(store, scope)).inputsReady, {
          timeout: 20000,
          interval: 250,
        })
        .toBe(true);
      const initial = await onboardingState(store, scope);
      expect(initial.datasets).toHaveLength(2);
      const orders = initial.datasets.find((d) => d.name === "setup_orders")!;
      expect(orders.data.profile.rows).toBe(125);
      expect(initial.datasets.some((d) => d.name === "setup_unselected")).toBe(
        false,
      );
      expect(
        initial.imports.every(
          (j) => j.kind === "job" && j.data.status === "succeeded",
        ),
      ).toBe(true);
      await sql("ALTER TABLE setup_orders ADD COLUMN status VARCHAR(20)");
      const source = initial.sources.find((s) => s.name === "setup_orders")!;
      const refresh = await post(`/sources/${source.id}/sync`, {});
      expect(refresh.statusCode).toBe(200);
      await expect
        .poll(
          async () => (await store.get(scope, orders.id))?.data.pendingVersion,
          { timeout: 15000, interval: 250 },
        )
        .toBeTruthy();
      const changed = (await store.get(scope, orders.id))!;
      expect(changed.data.activeVersion).toBe(orders.data.activeVersion);
      expect((await onboardingState(store, scope)).inputsReady).toBe(false);
      expect(
        (await onboardingState(store, scope)).blockers.some((b) =>
          b.includes("schema change"),
        ),
      ).toBe(true);
    } finally {
      stop();
      await app.close();
      await sql("DROP TABLE IF EXISTS setup_orders");
      await sql("DROP TABLE IF EXISTS setup_customers");
      await sql("DROP TABLE IF EXISTS setup_unselected");
      await db.end();
      if (scope)
        for (const d of ["incoming", "datasets"])
          await rm(resolve(config.dataDir, d, scope), {
            recursive: true,
            force: true,
          });
    }
  },
  30000,
);
