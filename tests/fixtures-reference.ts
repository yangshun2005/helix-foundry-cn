import { datasetTable } from "../packages/shared/src/index.js";
import { dataReply } from "./fixtures/data.js";
import { pipelinesReply } from "./fixtures/pipelines.js";
import { ontologyReply } from "./fixtures/ontology.js";
import { analystReply } from "./fixtures/analyst.js";
import { workspaceReply } from "./fixtures/workspace.js";
// Areas add new prompt branches in tests/fixtures/<area>.ts; they run first.
const areaReplies = [
  dataReply,
  pipelinesReply,
  ontologyReply,
  analystReply,
  workspaceReply,
];
// Deterministic provider fixture; SQL is still executed by the real DuckDB executor.
export function referenceReply(system: string, context: any) {
  for (const reply of areaReplies) {
    const value = reply(system, context);
    if (value !== undefined) return value;
  }
  if (system.includes("Return ready=true"))
    return { ready: true, message: "Connected" };
  if (system.includes("Describe the suggested ontology"))
    return {
      summary: "Accounts, their people, billing and support in one model.",
      entities: context.ontology.entities.map((e: any) => ({
        id: e.id,
        description: `One ${e.name.toLowerCase()} per row, from ${e.sources.map((s: any) => s.system).join(" and ")}.`,
      })),
      links: [
        ...context.ontology.links.map((l: any) => ({
          id: l.id,
          name: l.name === "belongs to" ? "is part of" : l.name,
        })),
        { id: "invented-link", name: "ignored" },
      ],
    };
  const loopwell = (name: string) =>
    context.datasets?.find((d: any) => d.name === name);
  if (
    loopwell("Stripe · subscriptions") &&
    system.includes("focused dashboard")
  ) {
    const accounts = loopwell("PlanetScale · accounts"),
      subscriptions = loopwell("Stripe · subscriptions");
    return {
      dashboards: [
        {
          name: "Loopwell overview",
          widgets: [
            {
              title: "Accounts",
              type: "metric",
              inputs: [accounts.id],
              sql: `SELECT count(*) AS accounts FROM "${datasetTable(accounts.id)}"`,
            },
            {
              title: "Subscriptions by status",
              type: "bar",
              inputs: [subscriptions.id],
              sql: `SELECT status, count(*) AS subscriptions FROM "${datasetTable(subscriptions.id)}" GROUP BY status`,
              x: "status",
              y: "subscriptions",
            },
          ],
        },
      ],
      actions: [],
    };
  }
  const customers = context.datasets.find(
      (d: any) => d.name.toLowerCase() === "customers",
    ),
    orders = context.datasets.find(
      (d: any) => d.name.toLowerCase() === "orders",
    );
  if (!customers || !orders)
    throw new Error("Reference fixture needs Customers and Orders");
  const c = datasetTable(customers.id),
    o = datasetTable(orders.id);
  if (system.includes("up to three distinct"))
    return {
      description:
        "Customers and their orders, including order amounts and delivery status.",
      outcomes: [
        {
          title: "Revenue and delayed orders",
          question:
            "How much revenue is represented, and which orders need attention?",
          goal: "Show revenue and delayed orders, with related customer and order records",
          evidence: [
            { datasetId: customers.id, columns: ["id", "name"] },
            { datasetId: orders.id, columns: ["customer", "amount", "status"] },
          ],
        },
      ],
    };
  if (system.includes("Describe the datasets"))
    return {
      summary: "Revenue and delayed orders",
      assumptions: [
        "Revenue includes delayed orders and means gross order amounts.",
      ],
      catalog: [
        {
          datasetId: customers.id,
          description: "One customer per row",
          tags: ["customers"],
        },
        {
          datasetId: orders.id,
          description: "One order per row",
          tags: ["orders"],
        },
      ],
    };
  if (system.includes("one useful simple pipeline"))
    return {
      pipelines: [
        {
          name: "Customer revenue",
          inputs: [customers.id, orders.id],
          sql: `SELECT c.id,sum(o.amount) revenue FROM ${c} c JOIN ${o} o ON c.id=o.customer GROUP BY c.id`,
          nodes: [],
          checks: [],
        },
      ],
    };
  if (system.includes("Suggest ontology"))
    return {
      ontology: [
        {
          name: "Customer",
          datasetId: customers.id,
          primaryKey: "id",
          properties: ["id", "name", "region"],
        },
        {
          name: "Order",
          datasetId: orders.id,
          primaryKey: "id",
          properties: ["id", "customer", "amount", "status"],
        },
      ],
      relationships: [
        {
          name: "Placed by",
          fromType: "Order",
          toType: "Customer",
          fromColumn: "customer",
          toColumn: "id",
        },
      ],
    };
  if (system.includes("focused dashboard"))
    return {
      dashboards: [
        {
          name: "Business view",
          widgets: [
            {
              title: "Revenue",
              type: "metric",
              inputs: [orders.id],
              sql: `SELECT sum(amount) revenue FROM ${o}`,
            },
            {
              title: "Delayed orders",
              type: "metric",
              inputs: [orders.id],
              sql: `SELECT count(*) delayed FROM ${o} WHERE status='delayed'`,
            },
            {
              title: "Revenue by customer",
              type: "bar",
              inputs: [customers.id, orders.id],
              sql: `SELECT c.name,sum(o.amount) revenue FROM ${c} c JOIN ${o} o ON c.id=o.customer GROUP BY c.name`,
              x: "name",
              y: "revenue",
            },
          ],
        },
      ],
      actions: [
        { name: "Update order", objectType: "Order", fields: ["status"] },
      ],
    };
  throw new Error("Unexpected fixture stage: " + system.slice(-180));
}
export const customerRows = [
  { id: "A", name: "Acme", region: "EU" },
  { id: "B", name: "Beta", region: "NA" },
];
export const orderRows = [
  { id: 1, customer: "A", amount: 10, status: "delayed" },
  { id: 2, customer: "A", amount: 20, status: "delivered" },
  { id: 3, customer: "B", amount: 5, status: "delivered" },
];
