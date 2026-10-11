import {
  useLayoutEffect,
  useRef,
  type RefObject,
  type TextareaHTMLAttributes,
} from "react";

// A textarea that grows with its text between minRows and maxRows, then
// scrolls. Enter submits; Shift+Enter (or Enter while composing text with an
// input method) adds a new line.
export function PromptInput({
  value,
  onValueChange,
  onSubmit,
  minRows = 1,
  maxRows = 6,
  inputRef,
  className,
  ...rest
}: {
  value: string;
  onValueChange: (value: string) => void;
  onSubmit: () => void;
  minRows?: number;
  maxRows?: number;
  inputRef?: RefObject<HTMLTextAreaElement | null>;
} & Omit<
  TextareaHTMLAttributes<HTMLTextAreaElement>,
  "value" | "onChange" | "onSubmit" | "rows"
>) {
  const own = useRef<HTMLTextAreaElement>(null),
    ref = inputRef || own;
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const style = getComputedStyle(el),
      line = parseFloat(style.lineHeight) || 20,
      pad = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    const min = line * minRows + pad,
      max = line * maxRows + pad;
    el.style.height = "auto";
    const full = el.scrollHeight;
    el.style.height = Math.max(min, Math.min(full, max)) + "px";
    el.style.overflowY = full > max + 1 ? "auto" : "hidden";
  }, [value, minRows, maxRows]);
  return (
    <textarea
      {...rest}
      ref={ref}
      rows={minRows}
      className={className}
      value={value}
      onChange={(e) => onValueChange(e.target.value)}
      onKeyDown={(e) => {
        rest.onKeyDown?.(e);
        if (e.defaultPrevented) return;
        if (
          e.key === "Enter" &&
          !e.shiftKey &&
          !e.altKey &&
          !e.nativeEvent.isComposing
        ) {
          e.preventDefault();
          onSubmit();
        }
      }}
    />
  );
}
