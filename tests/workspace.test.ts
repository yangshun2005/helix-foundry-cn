import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createApp } from "../apps/api/src/app.js";
import { MemoryStore, transaction, resource } from "../apps/api/src/store.js";
import {
  ActivityPageSchema,
  HomeSummarySchema,
} from "../packages/shared/src/index.js";
const store = new MemoryStore();
let app: Awaited<ReturnType<typeof createApp>>, scope: string;
beforeAll(async () => {
  app = await createApp(store);
  await app.ready();
  const me = (await app.inject({ method: "GET", url: "/api/v1/me" })).json();
  scope = me.workspaces[0].id;
  const generation = "gen-1";
  await transaction(store, scope, async (tx) => {
    const ws = (await tx.get("workspace"))!;
    tx.update(ws, { ...ws.data, activeGeneration: generation });
    const stripe = tx.put(
      resource(scope, "source", "customers", {
        kind: "stripe",
        connectionId: "op-stripe",
        connectionName: "Billing",
        secret: "sealed-secret",
      }),
    );
    const orders = tx.put(
      resource(scope, "source", "orders", {
        kind: "postgres",
        hostedProvider: "neon",
        connectionId: "op-neon",
        connectionName: "Shop database",
        secret: "sealed-secret",
      }),
    );
    tx.put(
      resource(scope, "job", "Sync customers", {
        type: "sync",
        sourceId: stripe.id,
        status: "succeeded",
      }),
    );
    tx.put(
      resource(scope, "job", "Sync orders", {
        type: "sync",
        sourceId: orders.id,
        status: "failed",
        error: "Connection refused",
      }),
    );
    tx.put(resource(scope, "dataset", "Customers", { sourceId: stripe.id }));
    tx.put(resource(scope, "dataset", "Events", { sampleSource: "posthog" }));
    tx.put(
      resource(scope, "objectType", "Customer", {
        generation,
        typeId: "type-customer",
        datasetId: "d1",
        properties: ["id", "name"],
        objectCount: 42,
      }),
    );
    tx.put(
      resource(scope, "objectType", "Order", {
        generation,
        typeId: "type-order",
        datasetId: "d2",
        properties: ["id"],
        objectCount: 7,
      }),
    );
    tx.put(
      resource(scope, "objectType", "Stale", {
        generation: "gen-0",
        typeId: "type-stale",
        datasetId: "d3",
        properties: [],
        objectCount: 1,
      }),
    );
    tx.put(
      resource(scope, "proposal", "Published", {
        status: "published",
        publishedGeneration: generation,
        bundle: {
          relationships: [
            { name: "Placed by", fromType: "Order", toType: "Customer" },
            { name: "Gone", fromType: "Stale", toType: "Customer" },
          ],
        },
      }),
    );
    tx.put(resource(scope, "proposal", "Pending", { status: "ready" }));
    tx.put(
      resource(scope, "finding", "Schema changed", {
        kind: "schema",
        dismissed: false,
      }),
    );
    tx.put(
      resource(scope, "dashboard", "Overview", {
        generation,
        widgets: [{}, {}],
      }),
    );
    const pipeline = tx.put(
      resource(scope, "pipeline", "Orders clean", {
        generation,
        inputs: [],
        sql: "select 1",
      }),
    );
    tx.put(
      resource(scope, "job", "Run Orders clean", {
        type: "pipeline",
        pipelineId: pipeline.id,
        status: "failed",
        error: "Binder error",
      }),
    );
    tx.put(
      resource(scope, "run", "Question", {
        goal: "How many orders?",
        status: "succeeded",
        checkpoint: { note: "internal-checkpoint" },
      }),
    );
  });
});
afterAll(() => app.close());
const home = (headers: Record<string, string> = {}) =>
  app.inject({
    method: "GET",
    url: `/api/v1/workspaces/${scope}/home`,
    headers,
  });
describe("workspace home summary", () => {
  it("summarizes health, ontology, reviews and dashboards", async () => {
    const r = await home();
    expect(r.statusCode).toBe(200);
    const summary = HomeSummarySchema.parse(r.json());
    expect(r.body).not.toContain("sealed-secret");
    expect(summary.counts).toMatchObject({
      sources: 2,
      objectTypes: 2,
      objects: 49,
      dashboards: 1,
    });
    const byName = Object.fromEntries(
      summary.connections.map((c) => [c.name, c]),
    );
    expect(byName["Shop database"]).toMatchObject({
      connector: "neon",
      status: "failed",
      error: "Connection refused",
    });
    expect(byName.Billing).toMatchObject({
      connector: "stripe",
      status: "healthy",
      datasets: 1,
    });
    expect(byName.posthog).toMatchObject({ sample: true, datasets: 1 });
    // Failing connections come first.
    expect(summary.connections[0].status).toBe("failed");
    expect(summary.ontology.types.map((t) => t.name)).toEqual([
      "Customer",
      "Order",
    ]);
    expect(summary.ontology.links).toEqual([
      { name: "Placed by", from: "Order", to: "Customer" },
    ]);
    expect(summary.proposals.pending).toBe(1);
    expect(summary.findings.open).toBe(1);
    expect(summary.dashboards).toEqual([
      expect.objectContaining({ name: "Overview", widgets: 2 }),
    ]);
    expect(summary.activity.some((a) => a.kind === "sync")).toBe(true);
    // Failed builds of published pipelines are reported per pipeline.
    expect(summary.pipelines).toMatchObject({
      failed: 1,
      failing: [
        expect.objectContaining({
          name: "Orders clean",
          error: "Binder error",
        }),
      ],
    });
    expect(summary.activity.find((a) => a.kind === "pipeline")).toMatchObject({
      title: "Orders clean",
      label: "Pipeline build",
      status: "failed",
    });
  });
  it("lists the activity feed with kind filters", async () => {
    const get = (query: string) =>
      app.inject({
        method: "GET",
        url: `/api/v1/workspaces/${scope}/activity${query}`,
      });
    const all = ActivityPageSchema.parse((await get("")).json());
    expect(all.total).toBeGreaterThanOrEqual(4);
    const builds = ActivityPageSchema.parse(
      (await get("?kind=pipeline,run")).json(),
    );
    expect(new Set(builds.items.map((a) => a.kind))).toEqual(
      new Set(["pipeline", "run"]),
    );
    expect((await get("?kind=bogus")).statusCode).toBe(400);
  });
  it("streams slim live activity with the review count", async () => {
    const address = await app.listen({ port: 0, host: "127.0.0.1" });
    const abort = new AbortController();
    const r = await fetch(`${address}/api/v1/workspaces/${scope}/events`, {
      signal: abort.signal,
    });
    const reader = r.body!.pipeThrough(new TextDecoderStream()).getReader();
    let text = "";
    while (!text.includes("\n\n")) text += (await reader.read()).value;
    abort.abort();
    const event = JSON.parse(text.slice(text.indexOf("data: ") + 6));
    expect(event.reviews).toBe(1);
    expect(event.runs.map((x: any) => x.data.goal)).toContain(
      "How many orders?",
    );
    expect(text).not.toContain("internal-checkpoint");
    expect(text).not.toContain("sealed-secret");
  });
  it("rejects an invalid API token instead of acting as the local owner", async () => {
    expect(
      (await home({ authorization: "Bearer not-a-token" })).statusCode,
    ).toBe(401);
  });
});
