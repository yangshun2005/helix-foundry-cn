// AIP Analyst area: route components lazy-loaded by main.tsx. There is no
// Analyst landing page: chats start from Home's ask box (or an Ask button),
// and the sidebar lists them under Analyst.
import "./analyst.css";
import { Navigate, Route, Routes, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import Assistant from "../../assistant";
import { useWorkspace, type AskContext } from "../../ui";
import { NotFound } from "../../shell/ErrorBoundary";
import { paths } from "../../paths";
import { chatListQuery } from "./launcher";
import { ChatPage, ChatSkeleton } from "./chat";

// /analyst opens the most recent chat, or Home to start one.
export function AnalystIndex() {
  const { id } = useWorkspace();
  const chats = useQuery(chatListQuery(id));
  if (chats.isPending) return <ChatSkeleton />;
  const latest = chats.data?.items[0];
  return (
    <Navigate to={latest ? paths.thread(latest.id) : paths.home()} replace />
  );
}
// /analyst/:threadId: a chat. A run id opens the chat the run belongs to.
export function AnalystThread() {
  const { threadId = "" } = useParams();
  return <ChatPage key={threadId} chatId={threadId} />;
}
// Global "Ask" panel opened by WorkspaceContext.ask() from any page: asking
// there opens the new chat.
export function AnalystPanel({
  context,
  onClose,
}: {
  context: AskContext;
  onClose: () => void;
}) {
  return <Assistant context={context} onClose={onClose} />;
}
// /analyst/*: the Analyst area's route table (main.tsx delegates the whole
// prefix).
export function AnalystRoutes() {
  return (
    <Routes>
      <Route index element={<AnalystIndex />} />
      <Route path=":threadId" element={<AnalystThread />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
