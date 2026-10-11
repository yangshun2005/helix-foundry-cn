import type {
  OnboardingState,
  Resource,
} from "../../../packages/shared/src/index.js";
import { assert, digest } from "./security.js";
import type { Store, Tx } from "./store.js";

export const publicResource = (r: Resource) => {
  const { secret, ...data } = r.data;
  if (r.kind === "job") delete data.file;
  return { ...r, data };
};
// One definition of readiness is used by the UI, generation, and atomic publication.
export async function onboardingState(
  store: Pick<Store, "get" | "list">,
  scope: string,
): Promise<OnboardingState> {
  const workspace = await store.get(scope, "workspace");
  assert(workspace, "Workspace not found", 404);
  const m = workspace.data.onboarding || {};
  const excluded: string[] = m.excludedIds || [];
  const [allDatasets, allSources, allJobs, provider, dashboards, operations] =
    await Promise.all([
      store.list(scope, "dataset"),
      store.list(scope, "source"),
      store.list(scope, "job"),
      store.get(scope, "provider"),
      store.list(scope, "dashboard"),
      store.list(scope, "operation"),
    ]);
  // Older batch imports stored their grouping on the operation, not the source.
  const connections = new Map<string, string>();
  for (const operation of operations)
    if (Array.isArray(operation.data.result))
      for (const item of operation.data.result)
        if (item.source?.id) connections.set(item.source.id, operation.id);
  const sources = allSources
    .filter((s) => !excluded.includes(s.id))
    .map((s) => ({
      ...s,
      data: {
        ...s.data,
        connectionId: s.data.connectionId || connections.get(s.id) || s.id,
      },
    }));
  const datasets = allDatasets.filter(
    (d) =>
      !d.data.generation &&
      !excluded.includes(d.id) &&
      !excluded.includes(d.data.sourceId) &&
      !excluded.includes(d.data.importJobId),
  );
  const jobs = allJobs.filter(
    (j) =>
      ["sync", "upload"].includes(j.data.type) &&
      !excluded.includes(j.id) &&
      !excluded.includes(j.data.sourceId) &&
      !excluded.includes(j.data.datasetId),
  );
  const latest = new Map<string, Resource>();
  for (const j of jobs.sort((a, b) => a.createdAt.localeCompare(b.createdAt)))
    latest.set(j.data.sourceId || j.data.datasetId || j.id, j);
  const imports = [...latest.values()];
  const blockers: string[] = [];
  for (const j of imports)
    if (
      j.data.status !== "succeeded" &&
      !(
        j.data.background &&
        ["queued", "running"].includes(j.data.status) &&
        datasets.some(
          (d) => d.data.sourceId === j.data.sourceId && d.data.activeVersion,
        )
      )
    )
      blockers.push(
        `${j.name}: ${j.data.status === "failed" || j.data.status === "canceled" ? "retry or remove this import" : "import is still in progress"}.`,
      );
  for (const s of sources)
    if (
      !datasets.some((d) => d.data.sourceId === s.id) &&
      !imports.some((j) => j.data.sourceId === s.id)
    )
      blockers.push(`${s.name}: start the import or remove this source.`);
  for (const d of datasets) {
    if (d.data.pendingVersion)
      blockers.push(`${d.name}: review the schema change before continuing.`);
    if (!d.data.activeVersion || !d.data.profile?.rows)
      blockers.push(
        `${d.name}: no records to analyze. Add records or remove this dataset from setup.`,
      );
  }
  if (!datasets.length)
    blockers.push("Import at least one dataset to continue.");
  const signature = digest(
    JSON.stringify({
      datasets: datasets
        .map((d) => [d.id, d.data.activeVersion, d.data.pendingVersion || null])
        .sort(),
      sources: sources.map((s) => s.id).sort(),
      incomplete: imports
        .filter((j) => j.data.status !== "succeeded")
        .map((j) => j.id)
        .sort(),
    }),
  );
  const [providerJob, recommendationRun, buildRun, ontologyRun] =
    await Promise.all([
      m.providerJobId && store.get(scope, m.providerJobId),
      m.recommendationRunId && store.get(scope, m.recommendationRunId),
      m.buildRunId && store.get(scope, m.buildRunId),
      m.ontologyRunId && store.get(scope, m.ontologyRunId),
    ]);
  // Sample datasets load one by one after the client has moved on; they count as
  // loaded once tagged, since discovery reads the tag.
  const samples = Object.entries(
    (workspace.data.sampleDatasetIds || {}) as Record<string, string>,
  ).filter(([, id]) => !excluded.includes(id));
  const pending = samples
    .filter(([, id]) => {
      const d = allDatasets.find((x) => x.id === id);
      return !d?.data.activeVersion || !d.data.sampleData;
    })
    .map(([name]) => name);
  const proposal = buildRun?.data.proposalId
    ? await store.get(scope, buildRun.data.proposalId)
    : !m.buildRunId
      ? (await store.list(scope, "proposal"))
          .filter((p) => p.data.status === "ready")
          .at(-1)
      : undefined;
  const activeDashboard =
    dashboards.find(
      (d) =>
        d.data.generation === workspace.data.activeGeneration &&
        d.id === m.dashboardId,
    ) ||
    dashboards.find(
      (d) => d.data.generation === workspace.data.activeGeneration,
    );
  const stale =
    !!proposal &&
    (proposal.data.onboardingSignature
      ? proposal.data.onboardingSignature !== signature ||
        proposal.data.onboardingRunId !== m.buildRunId
      : Object.entries(proposal.data.validation?.inputVersions || {}).some(
          ([id, v]) =>
            !datasets.some((d) => d.id === id && d.data.activeVersion === v),
        ));
  return {
    step: m.step || (datasets.length ? "outcome" : provider ? "data" : "ai"),
    deferred: !!m.deferred,
    goal: m.goal || "",
    complete: !!activeDashboard,
    dashboardId: activeDashboard?.id,
    excludedIds: excluded,
    sources: sources.map(publicResource),
    datasets,
    imports: imports.map(publicResource),
    providerJob: providerJob ? publicResource(providerJob) : undefined,
    providerReady:
      !!provider && (!providerJob || providerJob.data.status === "succeeded"),
    inputsReady: !blockers.length,
    blockers,
    signature,
    recommendationRun,
    buildRun,
    recommendations:
      recommendationRun?.data.onboardingSignature === signature &&
      recommendationRun.data.status === "succeeded"
        ? recommendationRun.data.recommendations
        : undefined,
    proposal,
    stale,
    sampleProgress: pending.length
      ? {
          total: samples.length,
          loaded: samples.length - pending.length,
          pending,
        }
      : undefined,
    ontology:
      m.ontologySuggestion?.signature === signature
        ? m.ontologySuggestion
        : undefined,
    ontologyRun: ontologyRun || undefined,
    ontologyConfirmed: m.ontology?.signature === signature,
    ontologyEdits:
      m.ontology?.signature === signature &&
      m.ontology.edits &&
      m.ontology.value?.hash === m.ontologySuggestion?.hash
        ? m.ontology.edits
        : undefined,
  };
}
export async function assertOnboardingPublication(tx: Tx, proposal: Resource) {
  if (!proposal.data.onboardingSignature) return;
  const state = await onboardingState(
    { get: (_s, id) => tx.get(id), list: (_s, kind) => tx.list(kind) },
    proposal.workspaceId,
  );
  assert(
    state.inputsReady &&
      state.signature === proposal.data.onboardingSignature &&
      state.buildRun?.id === proposal.data.onboardingRunId,
    "Setup inputs or outcome changed. Build your workspace again.",
    409,
  );
}
