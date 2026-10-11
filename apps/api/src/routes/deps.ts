import type { FastifyInstance } from "fastify";
import type { z } from "zod";
import type { Resource, Role } from "../../../../packages/shared/src/index.js";
import type { Store } from "../store.js";

// Resource kinds readable through GET /resources/:kind.
export const publicKinds = new Set([
  "dataset",
  "version",
  "source",
  "pipeline",
  "proposal",
  "run",
  "dashboard",
  "objectType",
  "object",
  "relation",
  "actionType",
  "audit",
  "finding",
  "publication",
  "query",
  "job",
  "lineage",
]);
// Kinds rebuilt by every publication; only the active generation is visible.
export const generationKinds = new Set([
  "pipeline",
  "dashboard",
  "objectType",
  "object",
  "relation",
  "actionType",
  "lineage",
]);
// Derived (pipeline output) datasets carry a generation too.
export const visibleIn = (r: Resource, activeGeneration: string | null) =>
  (!generationKinds.has(r.kind) &&
    !(r.kind === "dataset" && r.data.generation)) ||
  r.data.generation === activeGeneration;

export type Access = (
  req: any,
  min?: Role,
) => Promise<{ user: Resource; session: Resource; scope: string; role: Role }>;
export type RouteDeps = {
  // Authenticates the request and checks the workspace role; returns the scope.
  access: Access;
  // Strips secrets (and job file paths); apply to every resource returned.
  scrub: (r: Resource) => Resource;
  activeGeneration: (scope: string) => Promise<string | null>;
  visibleIn: typeof visibleIn;
};
export type RegisterRoutes = (
  app: FastifyInstance,
  store: Store,
  deps: RouteDeps,
) => void;
// Request bodies for the OpenAPI docs, keyed "METHOD /api/v1/...". Each area
// route module exports one; openapi.ts merges them.
export type RequestSchemas = Record<string, z.ZodType>;
