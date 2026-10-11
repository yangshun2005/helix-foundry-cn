// The global Ask panel (WorkspaceContext.ask, from Ask buttons around the
// app): a compact composer scoped to what the page is about. Asking starts a
// chat and opens it; answers are read on the chat page, not here.
import { useState } from "react";
import { ArrowUp, LoaderCircle } from "lucide-react";
import { Dialog } from "./kit";
import { useWorkspace, type AskContext } from "./ui";
import { useAskAnalyst } from "./areas/analyst/launcher";
import { readDraft, writeDraft } from "./areas/analyst/chat-data";
import { PromptInput } from "./areas/analyst/prompt-input";

export default function Assistant({
  context,
  onClose,
}: {
  context: AskContext;
  onClose: () => void;
}) {
  const { id, role } = useWorkspace(),
    ask = useAskAnalyst();
  const key = `foundry.compose.v1:${id}:${context.resourceId || context.page || "overview"}`;
  const [text, setText] = useState(() => context.prompt || readDraft(key)),
    [pending, setPending] = useState(false);
  const ready = text.trim().length >= 5 && !pending;
  const submit = async () => {
    if (!ready) return;
    setPending(true);
    // Opens the new chat; on failure the error is shown and the text kept.
    const chat = await ask({
      prompt: text,
      title: context.title,
      resourceId: context.resourceId,
    });
    if (chat) {
      writeDraft(key, "");
      onClose();
    } else setPending(false);
  };
  return (
    <Dialog
      title={context.title ? "Ask about " + context.title : "Ask Foundry"}
      description="Your question opens as a chat, where you can ask follow-ups."
      className="an-ask-dialog"
      onClose={onClose}
    >
      <form
        className="an-ask"
        aria-busy={pending || undefined}
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="an-composer">
          <PromptInput
            data-autofocus
            className="an-input"
            aria-label="Your question"
            aria-describedby="an-ask-hint"
            placeholder={
              role === "viewer"
                ? "Ask a question about this data…"
                : "Ask a question or describe what you need…"
            }
            minRows={3}
            maxRows={8}
            maxLength={4000}
            value={text}
            onValueChange={(v) => {
              setText(v);
              writeDraft(key, v);
            }}
            onSubmit={() => void submit()}
          />
          <button
            type="submit"
            className="an-send"
            aria-label="Ask"
            title="Ask"
            disabled={!ready}
          >
            {pending ? (
              <LoaderCircle size={17} className="hf-spin" aria-hidden />
            ) : (
              <ArrowUp size={17} aria-hidden />
            )}
          </button>
        </div>
        <p id="an-ask-hint" className="an-hint">
          Enter to ask · Shift+Enter for a new line
        </p>
      </form>
    </Dialog>
  );
}
