import { useId, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BookOpen,
  ChevronsUpDown,
  Laptop,
  Monitor,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  Settings,
  SquarePen,
  Sun,
  X,
} from "lucide-react";
import { api } from "../api";
import {
  Button,
  Dialog,
  DropdownMenu,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  Skeleton,
  cx,
} from "../kit";
import { paths } from "../paths";
import { useWorkspace } from "../ui";
import {
  chatIsActive,
  chatListQuery,
  type ChatSummary,
} from "../areas/analyst/launcher";
import { activeSection, childActive, primaryNav, type NavItem } from "./nav";
import type { NavBadge } from "./types";
import { useLiveActivity, useShell } from "./live";
import { ariaShortcut, shortcut } from "./shortcut";
import { themeOptions, useTheme } from "./theme";

export type ShellWorkspace = { id: string; name: string; role: string };
export type ShellUser = { id: string; name: string; email: string };
const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("") || "?";
const themeIcons = { light: Sun, dark: Moon, system: Monitor };

// A pending count beside a nav link. Hidden from the link's name (tests and
// screen readers keep "Activity"); announced as its description instead.
function Badge({ badge, id }: { badge?: NavBadge; id: string }) {
  const live = useLiveActivity(),
    n = badge?.count(live) || 0;
  if (!badge || n <= 0) return null;
  return (
    <>
      <span className="hf-nav-badge" aria-hidden>
        {n}
      </span>
      <span id={id} hidden>
        {badge.label(n)}
      </span>
    </>
  );
}
const useBadged = (badge?: NavBadge) => {
  const live = useLiveActivity();
  return !!badge && badge.count(live) > 0;
};

// Settings sits beside the user in the footer rather than in the section list.
function SettingsLink() {
  const { pathname } = useLocation(),
    active = activeSection(pathname) === "settings";
  return (
    <Link
      to={paths.settings()}
      className={cx(
        "hf-btn hf-btn--ghost hf-btn--md hf-btn--icon hf-settings-link",
        active && "is-active",
      )}
      aria-label="Settings"
      title="Settings"
      aria-current={active ? "page" : undefined}
    >
      <Settings size={17} aria-hidden />
    </Link>
  );
}
function NavLink({
  n,
  active,
  collapsed,
  pathname,
  nested,
}: {
  n: NavItem;
  active: boolean;
  collapsed: boolean;
  pathname: string;
  // Entries are listed under this link, so one of them is the current page.
  nested?: boolean;
}) {
  const id = useId(),
    badged = useBadged(n.badge);
  return (
    <Link
      to={n.to}
      className={cx("hf-nav-link", active && "is-active")}
      aria-current={
        active && (pathname === n.to || !(nested || n.children?.length))
          ? "page"
          : undefined
      }
      aria-describedby={badged ? id : undefined}
      title={collapsed ? n.label : undefined}
    >
      <n.icon size={17} aria-hidden />
      <span className="hf-nav-text">{n.label}</span>
      <Badge badge={n.badge} id={id} />
    </Link>
  );
}
function SubLink({
  c,
  on,
}: {
  c: NonNullable<NavItem["children"]>[number];
  on: boolean;
}) {
  const id = useId(),
    badged = useBadged(c.badge);
  return (
    <Link
      to={c.to}
      className={cx("hf-subnav-link", on && "is-active")}
      aria-current={on ? "page" : undefined}
      aria-describedby={badged ? id : undefined}
    >
      <span>{c.label}</span>
      <Badge badge={c.badge} id={id} />
    </Link>
  );
}

const CHAT_LIMIT = 8;
// One chat in the sidebar history: its first question, on one line.
function ChatLink({
  chat,
  on,
  onNavigate,
}: {
  chat: ChatSummary;
  on: boolean;
  onNavigate?: () => void;
}) {
  const id = useId(),
    busy = chatIsActive(chat);
  return (
    <Link
      to={paths.thread(chat.id)}
      onClick={onNavigate}
      className={cx("hf-chat-link", on && "is-active")}
      aria-current={on ? "page" : undefined}
      aria-describedby={busy ? id : undefined}
      title={chat.title}
    >
      <span className="hf-chat-title">{chat.title}</span>
      {busy && (
        <>
          <span className="hf-chat-dot" aria-hidden />
          <span id={id} hidden>
            Answering
          </span>
        </>
      )}
    </Link>
  );
}
// Every chat, newest first, under the Analyst link. New chats start on Home.
function ChatHistory({
  pathname,
  onNavigate,
}: {
  pathname: string;
  onNavigate?: () => void;
}) {
  const { id } = useWorkspace();
  const chats = useQuery({
    ...chatListQuery(id),
    // The live stream refreshes this when a run finishes; polling covers a
    // dropped stream while an answer is still being written.
    refetchInterval: (q) =>
      q.state.data?.items.some(chatIsActive) ? 5000 : false,
  });
  const [all, setAll] = useState(false),
    listId = useId();
  if (chats.isPending)
    return (
      <div className="hf-chats" aria-hidden>
        <Skeleton width="78%" height={10} className="hf-chats-skeleton" />
        <Skeleton width="56%" height={10} className="hf-chats-skeleton" />
      </div>
    );
  if (chats.error)
    return (
      <div className="hf-chats">
        <p className="hf-chats-note">
          Couldn’t load chats.{" "}
          <button
            type="button"
            className="hf-chats-toggle"
            onClick={() => void chats.refetch()}
          >
            Retry
          </button>
        </p>
      </div>
    );
  const items = chats.data.items;
  if (!items.length)
    return (
      <div className="hf-chats">
        <p className="hf-chats-note">Ask on Home to start a chat</p>
      </div>
    );
  const open = items.find((c) => pathname === paths.thread(c.id));
  let shown = all ? items : items.slice(0, CHAT_LIMIT);
  // The open chat stays listed, even when it is older than the first few.
  if (open && !shown.includes(open)) shown = [...shown, open];
  return (
    <div className="hf-chats">
      <ul id={listId} aria-label="Chats">
        {shown.map((c) => (
          <li key={c.id}>
            <ChatLink chat={c} on={c === open} onNavigate={onNavigate} />
          </li>
        ))}
      </ul>
      {items.length > CHAT_LIMIT && (
        <button
          type="button"
          className="hf-chats-toggle"
          aria-expanded={all}
          aria-controls={listId}
          onClick={() => setAll(!all)}
        >
          {all ? "Show fewer" : `Show all (${items.length})`}
        </button>
      )}
    </div>
  );
}

function NavLinks({
  items,
  collapsed,
  label,
  onNavigate,
}: {
  items: NavItem[];
  collapsed: boolean;
  label: string;
  // Closes the mobile drawer, also when a link opens the page already shown.
  onNavigate?: () => void;
}) {
  const { pathname } = useLocation(),
    section = activeSection(pathname);
  return (
    <ul className="hf-nav-list" aria-label={label}>
      {items.map((n) => {
        const active = section === n.id,
          chats = n.id === "analyst" && !collapsed;
        return (
          <li key={n.id} className={chats ? "hf-nav-item--chats" : undefined}>
            <NavLink
              n={n}
              active={active}
              collapsed={collapsed}
              pathname={pathname}
              nested={chats}
            />
            {chats && (
              <>
                {/* New chats start from Home's ask box. */}
                <Link
                  to={paths.home()}
                  state={{ ask: true }}
                  onClick={onNavigate}
                  className="hf-btn hf-btn--ghost hf-btn--sm hf-btn--icon hf-nav-action"
                  aria-label="New chat"
                  title="New chat"
                >
                  <SquarePen size={15} aria-hidden />
                </Link>
                <ChatHistory pathname={pathname} onNavigate={onNavigate} />
              </>
            )}
            {active && !collapsed && !!n.children?.length && (
              <ul className="hf-subnav">
                {n.children.map((c) => (
                  <li key={c.to}>
                    <SubLink c={c} on={childActive(pathname, c)} />
                  </li>
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function WorkspaceSwitcher({
  workspaces,
  current,
  onSwitch,
}: {
  workspaces: ShellWorkspace[];
  current: ShellWorkspace;
  onSwitch: (id: string) => void;
}) {
  const [creating, setCreating] = useState(false),
    [name, setName] = useState(""),
    [error, setError] = useState(""),
    [pending, setPending] = useState(false);
  const qc = useQueryClient(),
    navigate = useNavigate();
  return (
    <>
      <DropdownMenu
        label={`Workspace: ${current.name}`}
        className="hf-switcher"
        triggerClassName="hf-switcher-trigger"
        trigger={
          <>
            <span className="hf-ws-mark" aria-hidden>
              {initials(current.name)}
            </span>
            <span className="hf-switcher-text">
              <strong>{current.name}</strong>
            </span>
            <ChevronsUpDown
              size={14}
              className="hf-switcher-chevron"
              aria-hidden
            />
          </>
        }
      >
        <MenuLabel>Workspaces</MenuLabel>
        {workspaces.map((w) => (
          <MenuItem
            key={w.id}
            checked={w.id === current.id}
            onSelect={() => {
              if (w.id === current.id) return;
              onSwitch(w.id);
              navigate(paths.home());
            }}
          >
            {w.name}
          </MenuItem>
        ))}
        <MenuSeparator />
        <MenuItem icon={Plus} onSelect={() => setCreating(true)}>
          Create workspace
        </MenuItem>
      </DropdownMenu>
      {creating && (
        <Dialog
          title="Create a workspace"
          description="A new workspace starts with its own data, ontology and team."
          size="sm"
          onClose={() => setCreating(false)}
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setPending(true);
              setError("");
              try {
                const w = await api("/workspaces", { name: name.trim() });
                await qc.invalidateQueries({ queryKey: ["me"] });
                onSwitch(w.id);
                setCreating(false);
                navigate(paths.onboarding());
              } catch (err) {
                setError((err as Error).message);
              } finally {
                setPending(false);
              }
            }}
          >
            <label className="hf-field">
              <span>Workspace name</span>
              <input
                required
                autoFocus
                maxLength={100}
                placeholder="e.g. Acme"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            {error && (
              <p role="alert" className="hf-form-error">
                {error}
              </p>
            )}
            <div className="hf-form-actions">
              <Button onClick={() => setCreating(false)}>Cancel</Button>
              <Button
                type="submit"
                variant="primary"
                pending={pending}
                disabled={!name.trim()}
              >
                Create workspace
              </Button>
            </div>
          </form>
        </Dialog>
      )}
    </>
  );
}

// No accounts: everything here belongs to whoever uses this computer.
function LocalMenu({ collapsed }: { collapsed: boolean }) {
  const [theme, setTheme] = useTheme();
  return (
    <DropdownMenu
      label="Preferences"
      side="top"
      className="hf-user"
      triggerClassName="hf-user-trigger"
      trigger={
        <>
          <span className="hf-avatar" aria-hidden>
            <Laptop size={14} />
          </span>
          {!collapsed && (
            <span className="hf-user-text">
              <strong>This computer</strong>
              <small>Local · no sign-in</small>
            </span>
          )}
        </>
      }
    >
      <MenuItem icon={Settings} to={paths.settings()}>
        Settings
      </MenuItem>
      <MenuItem icon={BookOpen} href="/api/docs" external>
        API reference
      </MenuItem>
      <MenuSeparator />
      <MenuLabel>Theme</MenuLabel>
      {themeOptions.map(({ value, label }) => (
        <MenuItem
          key={value}
          icon={themeIcons[value]}
          checked={theme === value}
          onSelect={() => setTheme(value)}
        >
          {label}
        </MenuItem>
      ))}
    </DropdownMenu>
  );
}

export function Sidebar({
  workspaces,
  current,
  collapsed,
  onToggle,
  onClose,
  onSwitch,
}: {
  workspaces: ShellWorkspace[];
  current: ShellWorkspace;
  user: ShellUser;
  collapsed: boolean;
  // Desktop only: collapses the sidebar to icons.
  onToggle?: () => void;
  // Mobile drawer only: a visible close control in place of collapse.
  onClose?: () => void;
  onSwitch: (id: string) => void;
}) {
  const shell = useShell();
  return (
    <div className={cx("hf-sidebar-inner", collapsed && "is-collapsed")}>
      <div className="hf-brand-row">
        <Link to="/" className="hf-brand" aria-label="Helix Foundry home">
          <span className="hf-brand-name">
            helix<span>foundry</span>
          </span>
        </Link>
        <button
          type="button"
          className="hf-btn hf-btn--ghost hf-btn--sm hf-btn--icon hf-search-button"
          aria-label="Search"
          aria-keyshortcuts={ariaShortcut}
          title={`Search (${shortcut})`}
          onClick={() => shell.openPalette()}
        >
          <Search size={16} aria-hidden />
        </button>
        {onClose && (
          <button
            type="button"
            className="hf-btn hf-btn--ghost hf-btn--md hf-btn--icon"
            aria-label="Close navigation"
            title="Close navigation"
            data-autofocus
            onClick={onClose}
          >
            <X size={18} aria-hidden />
          </button>
        )}
        {onToggle && (
          <button
            type="button"
            className="hf-btn hf-btn--ghost hf-btn--sm hf-btn--icon hf-collapse"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            onClick={onToggle}
          >
            {collapsed ? (
              <PanelLeftOpen size={16} aria-hidden />
            ) : (
              <PanelLeftClose size={16} aria-hidden />
            )}
          </button>
        )}
      </div>
      <WorkspaceSwitcher
        workspaces={workspaces}
        current={current}
        onSwitch={onSwitch}
      />
      <nav aria-label="Main navigation" className="hf-nav">
        <NavLinks
          items={primaryNav}
          collapsed={collapsed}
          label="Workspace"
          onNavigate={onClose}
        />
        <div className="hf-nav-spacer" />
      </nav>
      <div className="hf-sidebar-foot">
        <LocalMenu collapsed={collapsed} />
        <SettingsLink />
      </div>
    </div>
  );
}
