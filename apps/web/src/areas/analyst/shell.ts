import { MessageSquareText } from "lucide-react";
import type { AreaShell } from "../../shell/types";
import { paths } from "../../paths";
import { relative } from "../../api";

// A run opens its chat: the chat's id is its first run's id. Runs from before
// chats had ids are their own chat here; the chat page follows them back.
const chatOf = (r: { id: string; data: Record<string, any> }) =>
  r.data.threadId || r.id;

export const analystShell: AreaShell = {
  // The sidebar lists chats under Analyst itself (shell/Sidebar.tsx).
  subnav: {},
  palette: [
    {
      id: "threads",
      label: "Chats",
      kind: "run",
      icon: MessageSquareText,
      // One entry per chat, titled by its first question: follow-ups belong to
      // their chat, and setup runs (describe, build) are not chats.
      filter: (r) => !r.data.task && chatOf(r) === r.id,
      title: (r) => r.data.goal || r.name,
      href: (r) => paths.thread(chatOf(r)),
      // When the chat started. Plain, so searching "ask" doesn't match every chat.
      subtitle: (r) => relative(r.createdAt),
    },
  ],
};
