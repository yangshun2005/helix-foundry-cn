import type { LucideIcon } from "lucide-react";
import type { Resource } from "../../../../packages/shared/src";
import type { LiveActivity } from "./live";

// Sidebar sections, in shell/nav.ts.
export type SectionId =
  | "home"
  | "data"
  | "pipelines"
  | "ontology"
  | "analyst"
  | "activity"
  | "settings";

// A count shown beside a nav entry, fed by the live event stream.
export type NavBadge = {
  count: (live: LiveActivity) => number;
  // Screen reader text for the count, e.g. "2 reviews pending".
  label: (n: number) => string;
};

// A sub-page shown under its section in the sidebar while the section is active.
export type NavChild = {
  to: string;
  label: string;
  // Path prefixes that mark this child active; defaults to [to].
  match?: string[];
  // Match `to` exactly instead of as a prefix.
  end?: boolean;
  badge?: NavBadge;
};

// One group of command palette results, fed by GET /resources/:kind. The
// callbacks run inside the shell: keep them cheap, and free of heavy imports.
export type PaletteSource = {
  id: string;
  // Group heading, e.g. "Datasets".
  label: string;
  kind: string;
  icon: LucideIcon;
  href: (r: Resource) => string;
  subtitle?: (r: Resource) => string;
  // Drop resources that should not be searchable.
  filter?: (r: Resource) => boolean;
  // Text used for the result title; defaults to r.name.
  title?: (r: Resource) => string;
};

// What each area contributes to the shell: sidebar children per section (an
// area may fill several sections) and palette groups.
export type AreaShell = {
  subnav?: Partial<Record<SectionId, NavChild[]>>;
  palette?: PaletteSource[];
};
