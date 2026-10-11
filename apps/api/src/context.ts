import type { Store } from "./store.js";

// Ontology-owned: an object with its workspace edits applied.
export async function effectiveObject(store: Store, scope: string, r: any) {
  const overlay = await store.get(scope, "overlay_" + r.data.logicalId);
  return {
    ...r,
    data: {
      ...r.data,
      effective: { ...r.data.base, ...overlay?.data.values },
      edits: overlay?.data.values || {},
    },
  };
}
