import type { OnboardingState, Resource } from "../../../packages/shared/src";

export type ConnectionGroup = {
  id: string;
  kind: string;
  name: string;
  sources: Resource[];
  datasets: Resource[];
  imports: Resource[];
};

// Count a database connection once even when it imports several tables.
export function connectionGroups(state?: OnboardingState): ConnectionGroup[] {
  if (!state) return [];
  const groups = new Map<string, ConnectionGroup>();
  const sourceGroups = new Map<string, ConnectionGroup>();
  const jobGroups = new Map<string, ConnectionGroup>();
  const add = (id: string, kind: string, name: string) => {
    if (!groups.has(id))
      groups.set(id, {
        id,
        kind,
        name,
        sources: [],
        datasets: [],
        imports: [],
      });
    return groups.get(id)!;
  };
  for (const source of state.sources) {
    const group = add(
      source.data.connectionId || source.id,
      source.data.kind,
      source.data.connectionName || source.name,
    );
    group.sources.push(source);
    sourceGroups.set(source.id, group);
  }
  for (const job of state.imports) {
    const group =
      sourceGroups.get(job.data.sourceId) ||
      (job.data.type === "upload"
        ? add(job.id, "upload", job.name)
        : undefined);
    if (group) {
      group.imports.push(job);
      jobGroups.set(job.id, group);
    }
  }
  for (const dataset of state.datasets) {
    if (dataset.data.sampleData) continue;
    const group =
      sourceGroups.get(dataset.data.sourceId) ||
      jobGroups.get(dataset.data.importJobId) ||
      add(dataset.id, dataset.data.sourceId ? "upload" : "api", dataset.name);
    group.datasets.push(dataset);
  }
  return [...groups.values()];
}
