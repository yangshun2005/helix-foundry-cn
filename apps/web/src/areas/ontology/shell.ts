import { Shapes } from "lucide-react";
import type { AreaShell } from "../../shell/types";
import { paths } from "../../paths";
import { number } from "../../api";

export const ontologyShell: AreaShell = {
  subnav: {
    ontology: [
      { to: paths.explorer(), label: "Explorer", match: ["/records"] },
      {
        to: paths.ontology(),
        label: "Object types",
        match: ["/ontology/types"],
        end: true,
      },
    ],
  },
  palette: [
    {
      id: "objectTypes",
      label: "Object types",
      kind: "objectType",
      icon: Shapes,
      href: (r) => paths.objectType(r.data.typeId || r.id),
      subtitle: (r) =>
        `${number(r.data.objectCount)} objects · ${r.data.properties?.length || 0} properties`,
    },
  ],
};
