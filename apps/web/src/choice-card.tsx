import { useId, type CSSProperties, type ReactNode } from "react";
import { Check } from "lucide-react";

export function ConnectionCard({
  title,
  description,
  icon,
  count,
  disabled,
  highlighted,
  onClick,
}: {
  title: string;
  description: string;
  icon: ReactNode;
  count: number;
  disabled?: boolean;
  // Position among the highlighted cards, so the highlight ripples across them.
  highlighted?: number | false;
  onClick: () => void;
}) {
  const descriptionId = useId();
  const lit = highlighted !== undefined && highlighted !== false;
  return (
    <button
      type="button"
      className={`choice-card connection-card${count ? " added" : ""}${lit ? " highlighted" : ""}`}
      style={lit ? ({ "--i": highlighted } as CSSProperties) : undefined}
      disabled={disabled}
      onClick={onClick}
      aria-label={title}
      aria-haspopup="dialog"
      aria-describedby={descriptionId}
    >
      <span className="choice-card-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="choice-card-heading">
        <span
          className={`connection-indicator${count ? " added" : ""}`}
          aria-hidden="true"
        >
          {count > 1 ? (
            count
          ) : count === 1 ? (
            <Check size={12} strokeWidth={2.5} />
          ) : null}
        </span>
        <strong>{title}</strong>
      </span>
      <span id={descriptionId} className="choice-card-description">
        {description}
        <span className="sr-only">
          {count ? ` · ${count} added` : " · None added"}
        </span>
      </span>
    </button>
  );
}

export function ChoiceCard({
  name,
  value,
  title,
  description,
  icon,
  checked,
  disabled,
  onChange,
}: {
  name: string;
  value: string;
  title: string;
  description: string;
  icon: ReactNode;
  checked: boolean;
  disabled?: boolean;
  onChange: () => void;
}) {
  const descriptionId = useId();
  return (
    <label className={`choice-card${checked ? " selected" : ""}`}>
      <span className="choice-card-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="choice-card-heading">
        <input
          type="radio"
          name={name}
          value={value}
          checked={checked}
          disabled={disabled}
          onChange={onChange}
          aria-label={title}
          aria-describedby={descriptionId}
        />
        <strong>{title}</strong>
      </span>
      <span id={descriptionId} className="choice-card-description">
        {description}
      </span>
    </label>
  );
}
