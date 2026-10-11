import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Link, useLocation } from "react-router-dom";
import { Menu, Search } from "lucide-react";
import { Dialog, PageVisitContext, cx, useStoredState } from "../kit";
import { useWorkspace } from "../ui";
import { CommandPalette } from "./CommandPalette";
import { ChromeBoundary } from "./ErrorBoundary";
import { ShellContext } from "./live";
import { primaryNav, secondaryNav } from "./nav";
import { recordRecent } from "./recents";
import { Sidebar, type ShellUser, type ShellWorkspace } from "./Sidebar";
import { syncThemeColor } from "./theme";

// Says where a navigation landed. When the old page took focus with it, focus
// moves to the new page's heading so keyboard users continue from there.
function RouteAnnouncer() {
  const { pathname } = useLocation(),
    [text, setText] = useState(""),
    first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    // Lazy pages render a moment later.
    const timer = setTimeout(() => {
      const heading = document.querySelector<HTMLElement>("#main h1");
      setText(
        heading?.textContent?.trim() ||
          document.title.replace(/ · Helix Foundry$/, ""),
      );
      const active = document.activeElement;
      if (heading && (!active || active === document.body)) {
        if (!heading.hasAttribute("tabindex"))
          heading.setAttribute("tabindex", "-1");
        heading.focus({ preventScroll: true });
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [pathname]);
  return (
    <div className="hf-sr-only" aria-live="polite" aria-atomic="true">
      {text}
    </div>
  );
}

// If the sidebar itself fails, plain links keep the app navigable.
function SidebarFallback() {
  return (
    <nav aria-label="Main navigation" className="hf-sidebar-fallback">
      {[...primaryNav, ...secondaryNav].map((n) => (
        <Link key={n.id} to={n.to}>
          {n.label}
        </Link>
      ))}
    </nav>
  );
}

// Workspace chrome: sidebar, mobile bar and drawer, and the command palette.
export function Shell({
  workspaces,
  current,
  user,
  onSwitch,
  children,
}: {
  workspaces: ShellWorkspace[];
  current: ShellWorkspace;
  user: ShellUser;
  onSwitch: (id: string) => void;
  children: ReactNode;
}) {
  const { notify } = useWorkspace();
  const [sidebar, setSidebar] = useStoredState("foundry.sidebar.v1", "open");
  const collapsed = sidebar === "collapsed";
  const [palette, setPalette] = useState<{ query: string } | null>(null),
    [drawer, setDrawer] = useState(false);
  const { pathname } = useLocation();
  useEffect(() => {
    setDrawer(false);
    setPalette(null);
  }, [pathname, current.id]);
  // The page behind the shell (scrollbars, overscroll) follows the theme.
  useEffect(() => {
    document.documentElement.classList.add("hf-root");
    syncThemeColor();
    return () => {
      document.documentElement.classList.remove("hf-root");
      syncThemeColor();
    };
  }, []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((p) => (p ? null : { query: "" }));
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  const shell = useMemo(
    () => ({
      openPalette: (query = "") => {
        setDrawer(false);
        setPalette({ query });
      },
    }),
    [],
  );
  const visit = useCallback(
    (title: string) =>
      recordRecent(
        current.id,
        window.location.pathname + window.location.search,
        title,
      ),
    [current.id],
  );
  const closePalette = useCallback(() => setPalette(null), []);
  const sidebarProps = { workspaces, current, user, onSwitch };
  return (
    <ShellContext.Provider value={shell}>
      <PageVisitContext.Provider value={visit}>
        <div className={cx("hf-shell", collapsed && "is-collapsed")}>
          <a className="hf-skip" href="#main">
            Skip to content
          </a>
          <aside className="hf-sidebar">
            <ChromeBoundary name="Sidebar" fallback={<SidebarFallback />}>
              <Sidebar
                {...sidebarProps}
                collapsed={collapsed}
                onToggle={() => setSidebar(collapsed ? "open" : "collapsed")}
              />
            </ChromeBoundary>
          </aside>
          <div className="hf-main-col">
            <header className="hf-mobile-bar">
              <button
                type="button"
                className="hf-btn hf-btn--ghost hf-btn--md hf-btn--icon"
                aria-label="Open navigation"
                onClick={() => setDrawer(true)}
              >
                <Menu size={18} aria-hidden />
              </button>
              <Link to="/" className="hf-brand" aria-label="Helix Foundry home">
                <span className="hf-brand-name">
                  helix<span>foundry</span>
                </span>
              </Link>
              <span className="hf-mobile-ws">{current.name}</span>
              <button
                type="button"
                className="hf-btn hf-btn--ghost hf-btn--md hf-btn--icon"
                aria-label="Search"
                onClick={() => shell.openPalette()}
              >
                <Search size={17} aria-hidden />
              </button>
            </header>
            <main className="hf-main" id="main" tabIndex={-1}>
              {children}
            </main>
          </div>
          <RouteAnnouncer />
          {palette && (
            <ChromeBoundary
              name="Command palette"
              onError={() => {
                closePalette();
                notify("Search hit a problem. Try again.", true);
              }}
            >
              <CommandPalette
                initialQuery={palette.query}
                workspaces={workspaces}
                current={current}
                onSwitch={onSwitch}
                onClose={closePalette}
              />
            </ChromeBoundary>
          )}
          {drawer && (
            <Dialog
              title="Navigation"
              hideTitle
              variant="drawer"
              className="hf-nav-drawer"
              onClose={() => setDrawer(false)}
            >
              <ChromeBoundary name="Navigation" fallback={<SidebarFallback />}>
                <Sidebar
                  {...sidebarProps}
                  collapsed={false}
                  onClose={() => setDrawer(false)}
                />
              </ChromeBoundary>
            </Dialog>
          )}
        </div>
      </PageVisitContext.Provider>
    </ShellContext.Provider>
  );
}
