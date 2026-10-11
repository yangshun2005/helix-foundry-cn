import { it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import { once } from "node:events";
import { readFile, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { discover, importSource } from "../apps/api/src/connectors.js";
import { workosApi } from "../apps/api/src/workos.js";
import { config } from "../apps/api/src/config.js";

const organizations = Array.from({ length: 150 }, (_, i) => ({
  object: "organization",
  id: "org_" + String(i).padStart(3, "0"),
  name: "Org " + i,
  created_at: "2025-01-01T00:00:00.000Z",
}));
const memberships = [
  { id: "om_1", organization_id: "org_000", user_id: "user_1" },
  { id: "om_2", organization_id: "org_149", user_id: "user_2" },
];
const directoryUsers = [
  { object: "directory_user", id: "du_1", directory_id: "dir_1", groups: [] },
  { object: "directory_user", id: "du_2", directory_id: "dir_1", groups: [] },
];
let server: Server;

function page(rows: any[], u: URL) {
  const limit = Number(u.searchParams.get("limit") || 10),
    after = u.searchParams.get("after"),
    start = after ? rows.findIndex((r) => r.id === after) + 1 : 0,
    data = rows.slice(start, start + limit),
    more = start + limit < rows.length;
  return {
    data,
    list_metadata: { before: null, after: more ? data.at(-1).id : null },
  };
}

beforeAll(async () => {
  server = createServer((req, res) => {
    const u = new URL(req.url!, "http://localhost");
    res.setHeader("content-type", "application/json");
    const send = (status: number, body: unknown) => {
      res.statusCode = status;
      res.end(JSON.stringify(body));
    };
    if (req.headers.authorization === "Bearer sk_test_bad")
      return send(401, { message: "Unauthorized" });
    const org = u.searchParams.get("organization_id");
    if (u.pathname === "/organizations")
      return send(200, page(organizations, u));
    if (u.pathname === "/user_management/organization_memberships") {
      if (!org && !u.searchParams.get("user_id"))
        return send(422, { message: "organization_id or user_id required" });
      return send(
        200,
        page(
          memberships.filter((m) => m.organization_id === org),
          u,
        ),
      );
    }
    if (u.pathname === "/directories")
      return send(200, page([{ id: "dir_1", organization_id: "org_000" }], u));
    if (u.pathname === "/directory_groups")
      return send(200, page([{ id: "dg_1", directory_id: "dir_1" }], u));
    if (u.pathname === "/directory_users")
      return send(
        200,
        page(
          u.searchParams.get("group") === "dg_1"
            ? directoryUsers.slice(0, 1)
            : directoryUsers,
          u,
        ),
      );
    if (u.pathname === "/connections")
      return send(404, { message: "Not found" });
    return send(200, page([], u));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  workosApi.base = "http://127.0.0.1:" + (server.address() as any).port;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
});

async function imported(table: string) {
  const scope = "workos-" + randomUUID();
  try {
    const result = await importSource(scope, "workos", {
      apiKey: "sk_test_abc",
      table,
    });
    const text = await readFile(
      resolve(config.dataDir, "incoming", scope, result.file),
      "utf8",
    );
    return {
      result,
      rows: text.trim()
        ? text
            .trim()
            .split("\n")
            .map((l) => JSON.parse(l))
        : [],
    };
  } finally {
    await rm(resolve(config.dataDir, "incoming", scope), {
      recursive: true,
      force: true,
    });
  }
}

it("lists readable WorkOS objects with relationships", async () => {
  const found: any = await discover("workos", { apiKey: "sk_test_abc" });
  expect(found.tables.map((t: any) => t.name)).toContain(
    "organization_memberships",
  );
  expect(found.unavailable).toEqual(["sso_connections"]);
  expect(found.foreignKeys).toContainEqual({
    tableName: "organization_memberships",
    columnName: "user_id",
    referencedTable: "users",
    referencedColumn: "user_id",
  });
  await expect(discover("workos", { apiKey: "sk_test_bad" })).rejects.toThrow(
    "rejected this key",
  );
  await expect(discover("workos", { apiKey: "pk_abc" })).rejects.toThrow(
    "WorkOS API key",
  );
});

it("imports every page with renamed IDs", async () => {
  const { rows, result } = await imported("organizations");
  expect(result.records).toBe(150);
  expect(rows[149]).toEqual({
    organization_id: "org_149",
    name: "Org 149",
    created_at: "2025-01-01T00:00:00.000Z",
  });
});

it("fans filtered lists out across their parents", async () => {
  const members = (await imported("organization_memberships")).rows;
  expect(members.map((m) => m.organization_membership_id)).toEqual([
    "om_1",
    "om_2",
  ]);
  const users = (await imported("directory_users")).rows;
  expect(users[0]).toEqual({
    directory_id: "dir_1",
    directory_user_id: "du_1",
  });
  const links = (await imported("directory_group_members")).rows;
  expect(links).toEqual([
    { directory_group_id: "dg_1", directory_user_id: "du_1" },
  ]);
});
