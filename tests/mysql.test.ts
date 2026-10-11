import { it, expect } from "vitest";
import mysql from "mysql2/promise";
import { randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { discover, importSource } from "../apps/api/src/connectors.js";
import { config } from "../apps/api/src/config.js";
it.skipIf(process.env.TEST_MYSQL !== "1")(
  "discovers keys and streams MySQL with lossless values and explicit failures",
  async () => {
    const c = {
      host: "127.0.0.1",
      port: 33077,
      user: "root",
      password: "foundry-test-only",
      database: "foundry_test",
      table: "foundry_fixture",
    };
    const { table, ...credentials } = c;
    const db = await mysql.createConnection(credentials);
    try {
      await db.query("DROP TABLE IF EXISTS foundry_fixture");
      await db.query(
        "CREATE TABLE foundry_fixture (id BIGINT UNSIGNED PRIMARY KEY, amount DECIMAL(30,8), happened DATETIME, title VARCHAR(100), optional VARCHAR(50) NULL)",
      );
      await db.execute("INSERT INTO foundry_fixture VALUES (?, ?, ?, ?, ?)", [
        "18446744073709551614",
        "1234567890123456789012.12345678",
        "2026-09-23 12:34:56",
        "東京 — café",
        null,
      ]);
      const d = await discover("mysql", c);
      expect(
        (d.tables as any[]).some((t) => t.name === "foundry_fixture"),
      ).toBe(true);
      expect(
        (d as any).keys.some(
          (k: any) => k.columnName === "id" && k.constraintName === "PRIMARY",
        ),
      ).toBe(true);
      const scope = "mysql-" + randomUUID(),
        result = await importSource(scope, "mysql", c),
        row = JSON.parse(
          (
            await readFile(
              resolve(config.dataDir, "incoming", scope, result.file),
              "utf8",
            )
          ).trim(),
        );
      expect(row).toMatchObject({
        id: "18446744073709551614",
        amount: "1234567890123456789012.12345678",
        happened: "2026-09-23 12:34:56",
        title: "東京 — café",
        optional: null,
      });
      const { execute } = await import("../services/executor/src/engine.js");
      const snapshot = await execute({
        mode: "ingest",
        scope,
        version: "precision",
        file: result.file,
      });
      expect(snapshot.rows[0]).toMatchObject({
        id: row.id,
        amount: row.amount,
        title: row.title,
        optional: null,
      });
      await db.query(
        "ALTER TABLE foundry_fixture ADD COLUMN new_field VARCHAR(20)",
      );
      const changed = await discover("mysql", c);
      expect(
        (changed as any).columns.some((x: any) => x.name === "new_field"),
      ).toBe(true);
      await db.query("DELETE FROM foundry_fixture");
      const empty = await importSource(scope, "mysql", c);
      const emptySnapshot = await execute({
        mode: "ingest",
        scope,
        version: "empty",
        file: empty.file,
        schema: empty.schema,
      });
      expect(emptySnapshot.profile.rows).toBe(0);
      expect(emptySnapshot.profile.columns.map((x) => x.name)).toContain("id");
      await expect(
        discover("mysql", { ...c, password: "incorrect" }),
      ).rejects.toThrow();
      await expect(
        discover("mysql", { ...c, tls: true, ca: "invalid CA" }),
      ).rejects.toThrow();
      await rm(resolve(config.dataDir, "datasets", scope), {
        recursive: true,
        force: true,
      });
      await rm(resolve(config.dataDir, "incoming", scope), {
        recursive: true,
        force: true,
      });
    } finally {
      await db.query("DROP TABLE IF EXISTS foundry_fixture");
      await db.end();
    }
  },
);

it.skipIf(process.env.TEST_MYSQL !== "1")(
  "fails interrupted MySQL snapshots without publishing partial data",
  async () => {
    const credentials = {
        host: "127.0.0.1",
        port: 33077,
        user: "root",
        password: "foundry-test-only",
        database: "foundry_test",
      },
      db = await mysql.createConnection(credentials),
      scope = "interrupted-" + randomUUID();
    try {
      await db.query(
        "CREATE OR REPLACE VIEW foundry_slow_view AS SELECT SLEEP(5) AS wait_result",
      );
      const importing = importSource(scope, "mysql", {
        ...credentials,
        table: "foundry_slow_view",
      });
      const rejected = expect(importing).rejects.toThrow();
      let interrupted = false;
      for (let i = 0; i < 20; i++) {
        const [rows] = await db.query(
          "SELECT ID FROM information_schema.PROCESSLIST WHERE INFO LIKE 'SELECT * FROM `foundry_slow_view`%'",
        );
        if ((rows as any[]).length) {
          await db.query("KILL CONNECTION " + Number((rows as any[])[0].ID));
          interrupted = true;
          break;
        }
        await new Promise((r) => setTimeout(r, 50));
      }
      expect(interrupted).toBe(true);
      await rejected;
    } finally {
      await db.query("DROP VIEW IF EXISTS foundry_slow_view");
      await db.end();
      await rm(resolve(config.dataDir, "incoming", scope), {
        recursive: true,
        force: true,
      });
    }
  },
);
