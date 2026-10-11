import { useState, useDeferredValue } from "react";
import { useResources } from "./ui";
export default function RecordPicker({
  label,
  value,
  onChange,
  initial,
}: {
  label: string;
  value: string;
  onChange: (id: string) => void;
  initial?: any;
}) {
  const [search, setSearch] = useState(""),
    deferred = useDeferredValue(search),
    q = useResources("object", { search: deferred, limit: 50 });
  const rows = q.data?.items || [],
    options =
      initial && !rows.some((r: any) => r.id === initial.id)
        ? [initial, ...rows]
        : rows;
  return (
    <label>
      {label}
      <input
        aria-label={"Search " + label.toLowerCase()}
        placeholder="Search records…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">Select a record</option>
        {options.map((r: any) => (
          <option key={r.id} value={r.id}>
            {r.name}
          </option>
        ))}
      </select>
    </label>
  );
}
