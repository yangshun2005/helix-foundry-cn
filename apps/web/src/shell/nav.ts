import {
  Database,
  House,
  Settings,
  Shapes,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import type {
  AreaShell,
  NavBadge,
  NavChild,
  PaletteSource,
  SectionId,
} from "./types";
import { dataShell } from "../areas/data/shell";
import { ontologyShell } from "../areas/ontology/shell";
import { analystShell } from "../areas/analyst/shell";
import { workspaceShell } from "../areas/workspace/shell";

export type NavItem = {
  id: SectionId;
  to: string;
  label: string;
  icon: LucideIcon;
  // Path prefixes that belong to this section (nested routes stay active).
  match: string[];
  children?: NavChild[];
  badge?: NavBadge;
};
const areas: AreaShell[] = [
  dataShell,
  ontologyShell,
  analystShell,
  workspaceShell,
];
const childrenOf = (id: SectionId) =>
  areas.flatMap((a) => a.subnav?.[id] || []);
const item = (
  id: SectionId,
  to: string,
  label: string,
  icon: LucideIcon,
  match: string[],
  extra: Partial<NavItem> = {},
): NavItem => ({
  id,
  to,
  label,
  icon,
  match,
  children: childrenOf(id),
  ...extra,
});

export const primaryNav: NavItem[] = [
  item("home", "/", "Home", House, []),
  // Ontology opens on its Explorer.
  item("ontology", "/ontology/explore", "Ontology", Shapes, [
    "/ontology",
    "/records",
  ]),
  item("data", "/data", "Data", Database, ["/data", "/sources"]),
  item("analyst", "/analyst", "Analyst", Sparkles, ["/analyst", "/runs"]),
];
export const secondaryNav: NavItem[] = [
  item("settings", "/settings", "Settings", Settings, ["/settings"]),
];
export const paletteSources: PaletteSource[] = areas.flatMap(
  (a) => a.palette || [],
);

const under = (pathname: string, prefix: string) =>
  pathname === prefix || pathname.startsWith(prefix + "/");
export function activeSection(pathname: string): SectionId | undefined {
  if (pathname === "/") return "home";
  return [...primaryNav, ...secondaryNav].find((n) =>
    n.match.some((m) => under(pathname, m)),
  )?.id;
}
export function childActive(pathname: string, child: NavChild) {
  const path = child.to.split("?")[0];
  return (
    (child.end ? pathname === path : under(pathname, path)) ||
    (child.match || []).some((m) => under(pathname, m))
  );
}
