import { resolve } from "node:path";
// PW_SLOT (0-9) shifts every port and the data directory so concurrent runs
// (one per agent or worktree) do not collide. Slot 0: API 3101, executor 3102,
// web 5174, .data/browser-isolated. Runs in the same slot must be serialized.
const slot = Math.min(
  Math.max(Math.trunc(Number(process.env.PW_SLOT)) || 0, 0),
  9,
);
export const ports = {
  api: 3101 + slot * 10,
  executor: 3102 + slot * 10,
  web: 5174 + slot * 10,
};
export const dataDir = resolve(
  ".data/browser-isolated" + (slot ? "-" + slot : ""),
);
// Screenshots and saved browser state from specs.
export const artifact = (name: string) => `${dataDir}/${name}`;
