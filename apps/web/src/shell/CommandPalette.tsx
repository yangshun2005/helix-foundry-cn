import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueries } from "@tanstack/react-query";
import {
  ArrowLeftRight,
  ArrowRight,
  CornerDownLeft,
  History,
  LoaderCircle,
  Moon,
  Plus,
  Search,
  Sparkles,
  Sun,
  type LucideIcon,
} from "lucide-react";
import type { Resource } from "../../../../packages/shared/src";
import { api } from "../api";
import { useWorkspace } from "../ui";
import { cx, useMedia } from "../kit";
import { paths } from "../paths";
import { paletteSources, primaryNav, secondaryNav } from "./nav";
import { readRecents, recordRecent, sectionIcon } from "./recents";
import { shortcutKeys } from "./shortcut";
import { useTheme } from "./theme";
import type { PaletteSource } from "./types";
import type { ShellWorkspace } from "./Sidebar";
import { useAskAnalyst } from "../areas/analyst/launcher";

type Entry = {
  key: string;
  group: string;
  title: string;
  subtitle?: string;
  icon: LucideIcon;
  run: () => void;
  disabled?: boolean;
};
const score = (text: string, q: string) => {
  const t = text.toLowerCase();
  if (!q) return 1;
  if (t.startsWith(q)) return 3;
  if (t.split(/[\s_·›-]+/).some((w) => w.startsWith(q))) return 2;
  return t.includes(q) ? 1 : 0;
};
const MIN_ASK = 5;
// Area callbacks run inside the shell; one bad resource must not break search.
function safe<T>(fn: (() => T) | undefined, fallback: T): T {
  try {
    return fn ? fn() : fallback;
  } catch (e) {
    console.error("Palette source failed:", e);
    return fallback;
  }
}
function describe(s: PaletteSource, r: Resource) {
  return {
    title: safe(s.title && (() => s.title!(r)), r.name) || r.name,
    subtitle: safe(s.subtitle && (() => s.subtitle!(r)), undefined),
    href: safe(() => s.href(r), ""),
    keep: safe(s.filter && (() => s.filter!(r)), true),
  };
}

// Global quick search (Cmd/Ctrl+K) over pages, actions and workspace resources.
export function CommandPalette({
  initialQuery = "",
  workspaces,
  current,
  onSwitch,
  onClose,
}: {
  initialQuery?: string;
  workspaces: ShellWorkspace[];
  current: ShellWorkspace;
  onSwitch: (id: string) => void;
  onClose: () => void;
}) {
  const { id, role, ask } = useWorkspace(),
    navigate = useNavigate(),
    askAnalyst = useAskAnalyst(),
    [theme, setTheme] = useTheme(),
    small = useMedia("(max-width: 800px)");
  const [query, setQuery] = useState(initialQuery),
    [active, setActive] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null),
    list = useRef<HTMLDivElement>(null);
  const listId = useId();
  const recents = useMemo(() => readRecents(id), [id]);
  useEffect(() => {
    const el = dialog.current!,
      previous = document.activeElement as HTMLElement | null;
    el.showModal();
    const cancel = (e: Event) => {
      e.preventDefault();
      onClose();
    };
    el.addEventListener("cancel", cancel);
    return () => {
      el.removeEventListener("cancel", cancel);
      el.close();
      previous?.focus();
    };
    // Mount-only: the dialog opens once per palette instance.
  }, []);
  const results = useQueries({
    queries: paletteSources.map((s) => ({
      queryKey: [id, s.kind, { limit: 200, palette: true }],
      staleTime: 30000,
      queryFn: () =>
        api<{ items: Resource[] }>(
          `/workspaces/${id}/resources/${s.kind}?limit=200`,
        ),
    })),
  });
  const loading = results.some((r) => r.isPending);
  const q = query.trim().toLowerCase();
  const go = (to: string) => () => {
    onClose();
    navigate(to);
  };
  const entries = useMemo(() => {
    const out: Entry[] = [];
    if (!q)
      for (const r of recents.slice(0, 5))
        out.push({
          key: "recent:" + r.path,
          group: "Recent",
          title: r.title,
          icon: sectionIcon(r.section) || History,
          run: go(r.path),
        });
    // With no query, only the sections; typing also finds their sub-pages.
    const pages = [...primaryNav, ...secondaryNav].flatMap((n) => [
      { title: n.label, to: n.to, icon: n.icon },
      ...(q ? n.children || [] : [])
        .filter((c) => c.to !== n.to)
        .map((c) => ({
          title: `${n.label} › ${c.label}`,
          to: c.to,
          icon: n.icon,
        })),
    ]);
    const actions: (Entry & { terms: string })[] = [
      {
        key: "action:ask",
        group: "Actions",
        title: "Ask Analyst",
        subtitle: "Open the Ask panel",
        terms: "ask analyst question ai",
        icon: Sparkles,
        run: () => {
          onClose();
          ask({ title: "your data" });
        },
      },
      ...(role !== "viewer"
        ? [
            {
              key: "action:add-data",
              group: "Actions",
              title: "Add data",
              subtitle: "Connect a database, app or file",
              terms: "add data connect source upload connection",
              icon: Plus,
              run: go(paths.connections(true)),
            },
          ]
        : []),
      {
        key: "action:theme",
        group: "Actions",
        title:
          theme === "light"
            ? "Switch to dark theme (beta)"
            : "Switch to light theme",
        terms: "theme dark light mode appearance",
        icon: theme === "light" ? Moon : Sun,
        run: () => {
          setTheme(theme === "light" ? "dark" : "light");
          onClose();
        },
      },
      ...workspaces
        .filter((w) => w.id !== current.id)
        .slice(0, 5)
        .map((w) => ({
          key: "action:workspace:" + w.id,
          group: "Actions",
          title: `Switch to ${w.name}`,
          subtitle: "Workspace",
          terms: "switch workspace " + w.name,
          icon: ArrowLeftRight,
          run: () => {
            onClose();
            onSwitch(w.id);
            navigate(paths.home());
          },
        })),
    ];
    if (!q) out.push(...actions);
    for (const p of pages)
      if (score(p.title, q))
        out.push({
          key: "page:" + p.title,
          group: "Go to",
          title: p.title,
          icon: p.icon,
          run: go(p.to),
        });
    if (q)
      paletteSources.forEach((s, i) => {
        const ranked = (results[i]?.data?.items || [])
          .map((r) => ({ r, ...describe(s, r) }))
          .filter((x) => x.keep && x.href)
          .map((x) => ({
            ...x,
            rank: Math.max(
              score(x.title, q) * 2,
              score(x.subtitle || "", q),
              score(x.r.description || "", q) ? 1 : 0,
            ),
          }))
          .filter((x) => x.rank > 0)
          .sort((x, y) => y.rank - x.rank)
          .slice(0, 6);
        for (const x of ranked)
          out.push({
            key: s.id + ":" + x.r.id,
            group: s.label,
            title: x.title,
            subtitle: x.subtitle,
            icon: s.icon,
            run: () => {
              recordRecent(id, x.href, x.title);
              go(x.href)();
            },
          });
      });
    if (q)
      out.push(...actions.filter((a) => score(a.terms + " " + a.title, q)));
    // Asking comes last so Enter opens the best match; alone, it is the match.
    if (q)
      out.push(
        q.length >= MIN_ASK
          ? {
              key: "ask",
              group: "Ask",
              title: `Ask Analyst: “${query.trim()}”`,
              subtitle: "Answers from your data, with sources",
              icon: Sparkles,
              run: () => {
                onClose();
                void askAnalyst({ prompt: query.trim(), title: "your data" });
              },
            }
          : {
              key: "ask",
              group: "Ask",
              title: "Ask Analyst",
              subtitle: `Type a question of ${MIN_ASK} or more characters`,
              icon: Sparkles,
              disabled: true,
              run: () => {},
            },
      );
    return out;
    // `go`, `ask` and `askAnalyst` are recreated each render but only close
    // over stable values.
  }, [query, results.map((r) => r.dataUpdatedAt).join(), role, theme]);
  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    list.current
      ?.querySelector(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);
  const groups = entries.reduce<Record<string, [Entry, number][]>>(
    (acc, e, i) => ((acc[e.group] ||= []).push([e, i]), acc),
    {},
  );
  return (
    <dialog
      ref={dialog}
      className="hf-palette"
      aria-label="Search your workspace"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="hf-palette-card">
        <div className="hf-palette-input">
          {loading && q ? (
            <LoaderCircle size={17} className="hf-spin" aria-hidden />
          ) : (
            <Search size={17} aria-hidden />
          )}
          <input
            autoFocus
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={
              entries[active] ? `${listId}-${active}` : undefined
            }
            aria-autocomplete="list"
            aria-label="Search datasets, pipelines, object types and more"
            placeholder={
              small
                ? "Search or ask…"
                : "Search datasets, pipelines, object types, threads…"
            }
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((a) => Math.min(a + 1, entries.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => Math.max(a - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                const entry = entries[active];
                if (entry && !entry.disabled) entry.run();
              }
            }}
          />
          <kbd className="hf-palette-esc" aria-hidden>
            esc
          </kbd>
          <button type="button" className="hf-palette-cancel" onClick={onClose}>
            Cancel
          </button>
        </div>
        <div
          ref={list}
          id={listId}
          role="listbox"
          aria-label="Results"
          className="hf-palette-list"
        >
          {Object.entries(groups).map(([group, items]) => (
            <div key={group} role="group" aria-label={group}>
              <div className="hf-palette-group" aria-hidden>
                {group}
              </div>
              {items.map(([e, i]) => (
                <div
                  key={e.key}
                  id={`${listId}-${i}`}
                  data-index={i}
                  role="option"
                  aria-selected={i === active}
                  aria-disabled={e.disabled || undefined}
                  className={cx(
                    "hf-palette-option",
                    i === active && "is-active",
                    e.disabled && "is-disabled",
                  )}
                  onMouseMove={() => setActive(i)}
                  onClick={() => !e.disabled && e.run()}
                >
                  <e.icon size={16} aria-hidden />
                  <span className="hf-palette-title">{e.title}</span>
                  {e.subtitle && (
                    <span className="hf-palette-subtitle">{e.subtitle}</span>
                  )}
                  {i === active && !e.disabled ? (
                    <CornerDownLeft size={14} aria-hidden />
                  ) : (
                    <ArrowRight size={14} aria-hidden className="is-quiet" />
                  )}
                </div>
              ))}
            </div>
          ))}
          {!entries.length && (
            <p className="hf-palette-empty">
              {loading ? "Searching…" : `No results for “${query}”`}
            </p>
          )}
        </div>
        <div className="hf-palette-foot" aria-hidden>
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> to navigate
          </span>
          <span>
            <kbd>↵</kbd> to open
          </span>
          <span>
            {shortcutKeys.map((k) => (
              <kbd key={k}>{k}</kbd>
            ))}{" "}
            to toggle
          </span>
        </div>
      </div>
    </dialog>
  );
}
