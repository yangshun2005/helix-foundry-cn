import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { paths } from "../../paths";
import { Segmented } from "../../kit";

// The Explorer shows records as a graph (default) or as a table by type.
export function useExplorerView() {
  const [params] = useSearchParams(),
    { pathname } = useLocation();
  // A type in the URL (e.g. an older /records?type= link) means its list.
  return pathname.startsWith("/records") ||
    params.get("view") === "table" ||
    params.has("type")
    ? "table"
    : "graph";
}
export function ExplorerSwitch() {
  const view = useExplorerView(),
    [params] = useSearchParams(),
    navigate = useNavigate();
  return (
    <Segmented
      label="View"
      value={view}
      options={[
        { value: "graph", label: "Graph" },
        { value: "table", label: "Table" },
      ]}
      onChange={(v) =>
        navigate(
          v === "table"
            ? params.get("type")
              ? paths.explorer(params.get("type")!)
              : paths.explorerTable()
            : paths.explorer(),
        )
      }
    />
  );
}
