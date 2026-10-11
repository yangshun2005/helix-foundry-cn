import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Resource } from "../../../../packages/shared/src";

// The slim copy of a job or run the event stream sends: data holds only
// status, type, task, goal, error, sourceId, pipelineId, datasetId and
// settings.provider.
export type LiveItem = Pick<
  Resource,
  "id" | "kind" | "name" | "createdAt" | "updatedAt" | "data"
>;
export type LiveActivity = {
  // Active, or updated in the last 24 hours.
  runs: LiveItem[];
  jobs: LiveItem[];
  // Proposals ready for review.
  reviews: number;
  // True while the event stream is open.
  connected: boolean;
};
const empty: LiveActivity = {
  runs: [],
  jobs: [],
  reviews: 0,
  connected: false,
};
const LiveContext = createContext<LiveActivity>(empty);
// Latest runs and jobs from GET /workspaces/:w/events (pushed on change).
export const useLiveActivity = () => useContext(LiveContext);
export const isActive = (r: Pick<Resource, "data">) =>
  ["queued", "running"].includes(r.data.status);

const signature = (items: LiveItem[]) =>
  items.map((r) => r.id + ":" + r.updatedAt + ":" + r.data.status).join("|");

export function LiveActivityProvider({
  workspaceId,
  children,
}: {
  workspaceId: string;
  children: ReactNode;
}) {
  const qc = useQueryClient();
  const [state, setState] = useState<LiveActivity>(empty);
  const last = useRef(""),
    seen = useRef(new Map<string, string>()),
    seeded = useRef(false),
    lastReviews = useRef(0);
  useEffect(() => {
    if (typeof EventSource === "undefined") return;
    last.current = "";
    seen.current = new Map();
    seeded.current = false;
    lastReviews.current = 0;
    setState(empty);
    const source = new EventSource(`/api/v1/workspaces/${workspaceId}/events`);
    source.onopen = () => setState((s) => ({ ...s, connected: true }));
    source.onerror = () => setState((s) => ({ ...s, connected: false }));
    source.onmessage = (e) => {
      let payload: { runs?: LiveItem[]; jobs?: LiveItem[]; reviews?: number };
      try {
        payload = JSON.parse(e.data);
      } catch {
        return;
      }
      const runs = payload.runs || [],
        jobs = payload.jobs || [],
        reviews = payload.reviews || 0;
      const sig = signature(runs) + "#" + signature(jobs) + "#" + reviews;
      if (sig === last.current) return;
      last.current = sig;
      // Something finished (or a review appeared): data elsewhere changed, so
      // refresh this workspace's queries. A job that starts and finishes
      // between two pushes is first seen already done; it counts too.
      let changed = seeded.current && reviews !== lastReviews.current;
      lastReviews.current = reviews;
      for (const r of [...runs, ...jobs]) {
        const key = r.updatedAt + ":" + r.data.status,
          before = seen.current.get(r.id);
        if (
          before !== key &&
          !isActive(r) &&
          (before !== undefined || seeded.current)
        )
          changed = true;
        seen.current.set(r.id, key);
      }
      seeded.current = true;
      if (changed) void qc.invalidateQueries({ queryKey: [workspaceId] });
      setState({ runs, jobs, reviews, connected: true });
    };
    return () => source.close();
  }, [workspaceId, qc]);
  return <LiveContext.Provider value={state}>{children}</LiveContext.Provider>;
}

export type ShellApi = {
  openPalette: (query?: string) => void;
};
export const ShellContext = createContext<ShellApi>({
  openPalette: () => {},
});
// Lets any page open the command palette or the activity tray.
export const useShell = () => useContext(ShellContext);
