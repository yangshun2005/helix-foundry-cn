import { it, expect, vi } from "vitest";
import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { execute as localExecute } from "../services/executor/src/engine.js";
vi.mock("../apps/api/src/executor.js", () => ({
  execute: (job: any) => localExecute(job),
}));
import { MemoryStore } from "../apps/api/src/store.js";
import { createApp } from "../apps/api/src/app.js";
import { ingestRows } from "../apps/api/src/datasets.js";
import { buildWorkspace, publishProposal } from "../apps/api/src/assistant.js";
import { prepareProvider } from "../apps/api/src/setup-jobs.js";
import { onboardingState } from "../apps/api/src/onboarding-state.js";
import { config } from "../apps/api/src/config.js";
import { customerRows, orderRows } from "./fixtures-reference.js";
it.skipIf(process.env.ONBOARDING_LOCAL !== "1")(
  "completes onboarding using the pinned local model without hosted calls",
  async () => {
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
        timeoutSeconds: 600,
      });
      await prepareProvider(store, scope, (await store.get(scope, job.id))!);
      await ingestRows(store, scope, "Customers", customerRows);
      await ingestRows(store, scope, "Orders", orderRows);
      const r = await post("/onboarding/recommendations", {});
      await buildWorkspace(store, scope, r.id);
      const state = await onboardingState(store, scope);
      expect(
        state.recommendations,
        (await store.get(scope, r.id))?.data.error,
      ).toBeTruthy();
      const run = await post("/onboarding/build", {
        goal: "Show total gross order revenue, the number of delayed orders, and revenue by customer in one dashboard. Create related Customer and Order records.",
      });
      await buildWorkspace(store, scope, run.id);
      const reviewed = await onboardingState(store, scope);
      expect(
        reviewed.proposal?.data.validation.valid,
        JSON.stringify({
          error: reviewed.buildRun?.data.error,
          checks: reviewed.proposal?.data.validation.checks,
        }),
      ).toBe(true);
      const actor = (await store.list("global", "user"))[0].id,
        p = reviewed.proposal!;
      await publishProposal(store, scope, p.id, p.data.hash, actor);
      expect((await onboardingState(store, scope)).complete).toBe(true);
      console.log(
        JSON.stringify({
          provider: "local",
          recommendationCalls: state.recommendationRun?.data.calls,
          buildCalls: reviewed.buildRun?.data.calls,
          tokens:
            (state.recommendationRun?.data.tokens || 0) +
            (reviewed.buildRun?.data.tokens || 0),
          checks: p.data.validation.checks.length,
          dashboards: p.data.bundle.dashboards.length,
        }),
      );
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
  240000,
);
