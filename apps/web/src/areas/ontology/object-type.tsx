import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { KeyRound, Search, Shapes } from "lucide-react";
import type { Resource } from "../../../../../packages/shared/src";
import { api } from "../../api";
import { useResources, useWorkspace } from "../../ui";
import {
  ButtonLink,
  DataGrid,
  EmptyState,
  KeyValue,
  Page,
  PageHeader,
  Panel,
  SkeletonText,
  Tag,
  formatNumber,
} from "../../kit";
import { paths } from "../../paths";

// Interim object type page: properties with types, backing dataset and counts.
export function ObjectTypeDetail({ typeId }: { typeId: string }) {
  const { id } = useWorkspace(),
    types = useResources("objectType");
  const type = ((types.data?.items || []) as Resource[]).find(
    (t) => t.data.typeId === typeId || t.id === typeId,
  );
  const dataset = useQuery({
    queryKey: [id, "dataset", type?.data.datasetId],
    enabled: !!type,
    queryFn: () =>
      api<Resource>(
        `/workspaces/${id}/resources/dataset/${type!.data.datasetId}`,
      ),
  });
  const crumbs = [{ label: "Ontology", to: paths.ontology() }];
  if (types.isPending)
    return (
      <Page>
        <SkeletonText lines={4} />
      </Page>
    );
  if (!type)
    return (
      <Page>
        <PageHeader breadcrumbs={crumbs} title="Object type unavailable" />
        <EmptyState
          icon={Shapes}
          title="This object type is not in the published ontology"
          text="It may have been renamed or removed in a later publication."
          action={
            <ButtonLink to={paths.ontology()}>Back to Ontology</ButtonLink>
          }
        />
      </Page>
    );
  const columns: { name: string; type: string; nulls: number }[] =
    dataset.data?.data.profile?.columns || [];
  const properties = (type.data.properties as string[]).map((name) => {
    const c = columns.find((x) => x.name === name);
    return {
      name,
      type: c?.type || "—",
      key: name === type.data.primaryKey,
      nulls: c?.nulls ?? null,
    };
  });
  return (
    <Page>
      <PageHeader
        breadcrumbs={[...crumbs, { label: type.name }]}
        icon={<Shapes size={22} aria-hidden />}
        eyebrow="Object type"
        title={type.name}
        subtitle={type.description || type.data.description || undefined}
        meta={
          <>
            <span>{formatNumber(type.data.objectCount)} objects</span>
            <span>{properties.length} properties</span>
          </>
        }
        actions={
          <ButtonLink
            variant="primary"
            icon={Search}
            to={paths.explorer(type.name)}
          >
            Explore objects
          </ButtonLink>
        }
      />
      <div className="on-type-grid">
        <Panel title="Properties" padded={false}>
          <DataGrid
            label="Properties"
            rows={properties}
            getRowKey={(r) => r.name}
            maxHeight={480}
            columns={[
              {
                key: "name",
                label: "Property",
                width: 220,
                render: (r) => (
                  <span className="on-prop">
                    {r.name}
                    {r.key && (
                      <Tag tone="accent" icon={KeyRound}>
                        Primary key
                      </Tag>
                    )}
                  </span>
                ),
              },
              { key: "type", label: "Type", width: 140 },
              { key: "nulls", label: "Missing values", type: "integer" },
            ]}
          />
        </Panel>
        <Panel title="Details">
          <KeyValue
            items={[
              {
                label: "Backing dataset",
                value: dataset.data ? (
                  <Link to={paths.dataset(dataset.data.id)}>
                    {dataset.data.name}
                  </Link>
                ) : (
                  type.data.datasetId
                ),
              },
              { label: "Primary key", value: type.data.primaryKey, mono: true },
              { label: "Objects", value: formatNumber(type.data.objectCount) },
              { label: "Type ID", value: type.data.typeId, mono: true },
            ]}
          />
        </Panel>
      </div>
    </Page>
  );
}
