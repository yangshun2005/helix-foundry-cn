import { it, expect, vi } from "vitest";
import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { execute as localExecute } from "../services/executor/src/engine.js";
vi.mock("../apps/api/src/executor.js", () => ({
  execute: (job: any) => localExecute(job),
}));
import { MemoryStore } from "../apps/api/src/store.js";
import { createApp } from "../apps/api/src/app.js";
import { buildWorkspace } from "../apps/api/src/assistant.js";
import { prepareProvider } from "../apps/api/src/setup-jobs.js";
import { onboardingState } from "../apps/api/src/onboarding-state.js";
import { config } from "../apps/api/src/config.js";

// Opt-in: runs the real Ollama qwen3:4b model against the Loopwell sample data.
it.skipIf(process.env.ONBOARDING_LOCAL !== "1")(
  "suggests an ontology and builds a workspace from the Loopwell sample data with the local model",
  async () => {
    const log = (label: string, v: unknown) =>
      console.log(`### ${label}\n` + JSON.stringify(v, null, 2));
    const store = new MemoryStore(),
      app = await createApp(store);
    let scope = "";
    try {
      const me = await app.inject({ method: "GET", url: "/api/v1/me" });
      expect(me.statusCode).toBe(200);
      scope = me.json().workspaces[0].id;
      const post = async (path: string, payload: unknown) => {
        const r = await app.inject({
          method: "POST",
          url: `/api/v1/workspaces/${scope}` + path,
          payload: payload as any,
        });
        expect(r.statusCode, r.body).toBe(200);
        return r.json();
      };
      const job = await post("/onboarding/provider", {
        provider: "local",
        model: "qwen3:4b",
        baseUrl: "http://127.0.0.1:11434",
        timeoutSeconds: 900,
      });
      await prepareProvider(store, scope, (await store.get(scope, job.id))!);
      const demo = await post("/demo", { advance: true });
      log(
        "demo datasets",
        demo.datasets.map((d: any) => d.name ?? d.data?.name ?? d.id),
      );

      // 1. Suggested ontology, then the AI description run
      const suggested = await post("/onboarding/ontology", {});
      log("suggested ontology", {
        summary: suggested.ontology?.summary,
        entities: suggested.ontology?.entities.map(
          (e: any) => `${e.name} (${e.kind}): ${e.members.length} datasets`,
        ),
        links: suggested.ontology?.links.map(
          (l: any) => `${l.from} ${l.name} ${l.to} via ${l.fromColumn}`,
        ),
        notes: suggested.ontology?.notes.map((n: any) => n.text),
      });
      expect(suggested.ontology?.entities.length).toBeGreaterThan(0);
      if (suggested.ontologyRun)
        await buildWorkspace(store, scope, suggested.ontologyRun.id);
      const described = await onboardingState(store, scope);
      const describeRun = described.ontologyRun;
      log("described ontology", {
        status: describeRun?.data.status,
        error: describeRun?.data.error,
        calls: describeRun?.data.calls,
        tokens: describeRun?.data.tokens,
        described: described.ontology?.described,
        summary: described.ontology?.summary,
        entities: described.ontology?.entities.map(
          (e: any) => `${e.name}: ${e.description}`,
        ),
        links: described.ontology?.links.map((l: any) => `${l.id}: ${l.name}`),
      });
      // The description may fail on a small model; the computed text then stays.
      expect(described.ontology?.hash).toBe(suggested.ontology.hash);

      // 2. Confirm as suggested, then build; the build publishes itself
      const confirmed = await post("/onboarding/ontology/confirm", {
        hash: described.ontology!.hash,
      });
      expect(confirmed.ontologyConfirmed).toBe(true);
      const run = confirmed.buildRun;
      let buildError: unknown;
      try {
        await buildWorkspace(store, scope, run.id);
      } catch (e) {
        buildError = String(e);
      }
      const built = await onboardingState(store, scope);
      const buildRun = await store.get(scope, run.id);
      const p = built.proposal;
      const bundle = p?.data.bundle;
      log("build", {
        goal: run.data.goal,
        error: buildError ?? buildRun?.data.error,
        stage: buildRun?.data.stage,
        calls: buildRun?.data.calls,
        tokens: buildRun?.data.tokens,
        events: buildRun?.data.events?.map(
          (e: any) => `${e.stage}: ${String(e.message).slice(0, 160)}`,
        ),
        complete: built.complete,
        valid: p?.data.validation?.valid,
        failedChecks: p?.data.validation?.checks?.filter(
          (c: any) => c.passed === false,
        ),
        allChecks: p?.data.validation?.checks,
        pipelines: bundle?.pipelines?.map((x: any) => x.name),
        ontology: bundle?.ontology?.map((t: any) => ({
          name: t.name,
          datasetId: t.datasetId,
          primaryKey: t.primaryKey,
        })),
        relationships: bundle?.relationships,
        dashboards: bundle?.dashboards?.map((d: any) => ({
          title: d.title ?? d.name,
          widgets: d.widgets?.map((w: any) => w.title ?? w.name),
        })),
      });
      expect(
        built.complete,
        JSON.stringify({
          error: buildRun?.data.error,
          checks: p?.data.validation?.checks,
        }),
      ).toBe(true);
      expect(p?.data.status).toBe("published");
    } finally {
      await app.close();
      if (scope)
        for (const d of ["incoming", "datasets"])
          await rm(resolve(config.dataDir, d, scope), {
            recursive: true,
            force: true,
          });
    }
  },
  3600000,
);
