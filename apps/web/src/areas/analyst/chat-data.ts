// Chat data for the Analyst: a chat is a question and its follow-ups, one
// assistant run per turn. The chat list lives in ./launcher (shared with the
// sidebar); this file holds one chat, its runs and how they read.
import type { Resource } from "../../../../../packages/shared/src";
import { chatListKey } from "./launcher";

export type Chat = { id: string; title: string; runs: Resource[] };

// Under the list's key, so refreshing the list (or the live event stream,
// which refreshes everything under the workspace) refreshes open chats too.
export const chatKey = (workspaceId: string, chatId: string) => [
  ...chatListKey(workspaceId),
  chatId,
];

export const isWorking = (status?: string) =>
  status === "queued" || status === "running";
// The chat a run belongs to: its first run's id.
export const chatIdOf = (run: Pick<Resource, "id" | "data">) =>
  (run.data.threadId as string | undefined) || run.id;

// GET that resolves to null on 404, so "not found" can be told apart from a
// failed request.
async function getOrNull<T>(path: string): Promise<T | null> {
  const res = await fetch("/api/v1" + path, { credentials: "same-origin" });
  if (res.status === 404) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data as T;
}
export const fetchChat = (workspaceId: string, chatId: string) =>
  getOrNull<Chat>(
    `/workspaces/${workspaceId}/threads/${encodeURIComponent(chatId)}`,
  );
// Sent without a JSON content type: the API rejects an empty JSON body.
export async function deleteChat(workspaceId: string, chatId: string) {
  const res = await fetch(
    `/api/v1/workspaces/${workspaceId}/threads/${encodeURIComponent(chatId)}`,
    { method: "DELETE", credentials: "same-origin" },
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Couldn’t delete this chat");
}
const fetchRun = (workspaceId: string, runId: string) =>
  getOrNull<Resource>(
    `/workspaces/${workspaceId}/resources/run/${encodeURIComponent(runId)}`,
  );

// For an id that is not a chat: the run it names, and the chat that run
// belongs to. Runs from before chats had ids follow the question they
// followed up on back to the first one.
export async function resolveRun(workspaceId: string, runId: string) {
  const run = await fetchRun(workspaceId, runId);
  if (!run) return null;
  let first = run;
  for (let hops = 0; hops < 50 && !first.data.threadId; hops++) {
    const previous = first.data.context?.resourceId;
    if (!previous || previous === first.id) break;
    const before = await fetchRun(workspaceId, previous).catch(() => null);
    if (!before || before.data.task) break;
    first = before;
  }
  return { run, chatId: chatIdOf(first) };
}

const stages: Record<string, string> = {
  queued: "Getting started…",
  routing: "Understanding your question…",
  analysis: "Writing a query…",
  query: "Checking your data…",
  summary: "Summarising the results…",
  complete: "Finishing up…",
  catalog: "Understanding your data…",
  pipelines: "Preparing the data…",
  ontology: "Connecting business records…",
  dashboards: "Creating your view…",
  validation: "Testing the result…",
  publishing: "Publishing your changes…",
  review: "Ready for your review",
};
export function stageText(data: Record<string, any>) {
  const last = data.events?.at(-1);
  if (data.stage === "queued" && last?.message === "Trying again")
    return "Trying again…";
  if (stages[data.stage]) return stages[data.stage];
  if (String(data.stage || "").includes("repair"))
    return "Refining the result…";
  return "Working on it…";
}
// When the current attempt started: a retry restarts the clock.
export function startedAt(run: Resource) {
  const retry = [...(run.data.events || [])]
    .reverse()
    .find((e: any) => e.stage === "queued");
  return Date.parse(retry?.at || run.createdAt);
}

// Viewers may stop or retry their own questions, but not changes.
export function canControl(
  run: Resource,
  role: string,
  userId: string,
): boolean {
  const d = run.data;
  return (
    role !== "viewer" ||
    (d.authority?.userId === userId &&
      (d.resolvedIntent || d.intent) !== "build")
  );
}

// A failure in plain words; the raw message stays available as detail.
export function plainError(error?: string | null): {
  text: string;
  detail?: string;
} {
  const raw = (error || "").trim();
  if (!raw) return { text: "Something went wrong before an answer was ready." };
  if (
    /(Binder|Parser|Catalog|Conversion|Invalid Input|Constraint) Error|syntax error|SQL/i.test(
      raw,
    )
  )
    return {
      text: "The query written for this question didn’t run against your data. Trying again, or rephrasing the question, usually helps.",
      detail: raw,
    };
  if (/timed? ?out|timeout|deadline/i.test(raw))
    return { text: "This took too long to answer.", detail: raw };
  if (/api key|provider|model|rate limit|quota|401|429/i.test(raw))
    return {
      text: "The AI model couldn’t be reached. Check the model settings, then try again.",
      detail: raw,
    };
  // Short messages are already written for people.
  return raw.length <= 160 && !/\n|at \w+ \(/.test(raw)
    ? { text: raw }
    : { text: "Something went wrong before an answer was ready.", detail: raw };
}

// "A", "A and B", "A, B and C".
export const listText = (names: string[]) =>
  names.length <= 1
    ? names[0] || ""
    : names.slice(0, -1).join(", ") + " and " + names.at(-1);

// Drafts are kept per chat for the session. Storage may be unavailable.
export function readDraft(key: string) {
  try {
    return sessionStorage.getItem(key) || "";
  } catch {
    return "";
  }
}
export function writeDraft(key: string, value: string) {
  try {
    if (value) sessionStorage.setItem(key, value);
    else sessionStorage.removeItem(key);
  } catch {
    /* the draft is a convenience */
  }
}
