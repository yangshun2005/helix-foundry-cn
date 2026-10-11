import { it, expect } from "vitest";
import { sampleDatasets } from "../apps/api/src/sample-data.js";
import { sampleSources } from "../packages/shared/src/index.js";

const samples = sampleDatasets();
const rows = (name: string) => samples.find((d) => d.name === name)!.rows;
const accounts = rows("PlanetScale · accounts");
const users = rows("PlanetScale · users");
const workosUsers = rows("WorkOS · users");
const organizations = rows("WorkOS · organizations");
const customers = rows("Stripe · customers");
const subscriptions = rows("Stripe · subscriptions");
const invoices = rows("Stripe · invoices");
const events = rows("PostHog · events");
const tickets = rows("S3 · support_tickets.csv");
const campaigns = rows("S3 · marketing_campaigns.csv");

function coverage(
  from: Record<string, unknown>[],
  column: string,
  to: Record<string, unknown>[],
  key: string,
) {
  const keys = new Set(to.map((r) => r[key]));
  const values = from.map((r) => r[column]).filter((v) => v != null);
  return values.filter((v) => keys.has(v)).length / values.length;
}

it("is deterministic and covers every sample source", () => {
  expect(JSON.stringify(sampleDatasets())).toBe(JSON.stringify(samples));
  expect(new Set(samples.map((d) => d.source))).toEqual(new Set(sampleSources));
});

it("gives every dataset a unique, non-null *_id primary key first", () => {
  for (const d of samples) {
    const key = Object.keys(d.rows[0])[0];
    expect(key, d.name).toMatch(/_id$/);
    const values = d.rows.map((r) => r[key]);
    expect(
      values.every((v) => v != null),
      d.name,
    ).toBe(true);
    expect(new Set(values).size, d.name).toBe(values.length);
    // Every row has the same columns, so profiles and samples line up.
    for (const r of d.rows)
      expect(Object.keys(r), d.name).toEqual(Object.keys(d.rows[0]));
  }
});

it("links the systems through explicit IDs", () => {
  expect(coverage(users, "account_id", accounts, "account_id")).toBe(1);
  expect(coverage(users, "workos_user_id", workosUsers, "user_id")).toBe(1);
  expect(
    coverage(
      accounts,
      "workos_organization_id",
      organizations,
      "organization_id",
    ),
  ).toBe(1);
  expect(
    coverage(accounts, "stripe_customer_id", customers, "customer_id"),
  ).toBe(1);
  expect(coverage(subscriptions, "customer_id", customers, "customer_id")).toBe(
    1,
  );
  expect(
    coverage(invoices, "subscription_id", subscriptions, "subscription_id"),
  ).toBe(1);
  expect(coverage(tickets, "account_id", accounts, "account_id")).toBe(1);
  expect(
    coverage(
      rows("WorkOS · sso_connections"),
      "organization_id",
      organizations,
      "organization_id",
    ),
  ).toBe(1);
  // Identified events use the app user_id; anonymous visits before signup do not.
  const identified = coverage(events, "distinct_id", users, "user_id");
  expect(identified).toBeGreaterThan(0.95);
  expect(identified).toBeLessThan(1);
});

it("keeps realistic fragmentation to reconcile", () => {
  // Two signups recorded a mistyped campaign code.
  expect(
    coverage(accounts, "signup_campaign_id", campaigns, "campaign_id"),
  ).toBeLessThan(1);
  // Help desk email requests carry no account, and some addresses differ in case.
  expect(tickets.some((t) => t.account_id === null)).toBe(true);
  const emails = new Set(users.map((u) => u.email));
  expect(
    tickets.some(
      (t) =>
        !emails.has(t.requester_email) &&
        emails.has(String(t.requester_email).toLowerCase()),
    ),
  ).toBe(true);
  // Stripe and WorkOS hold records the app does not know about.
  const known = new Set(accounts.map((a) => a.stripe_customer_id));
  expect(customers.filter((c) => !known.has(c.customer_id))).toHaveLength(2);
  const orgs = new Set(accounts.map((a) => a.workos_organization_id));
  expect(
    organizations.filter((o) => !orgs.has(o.organization_id)),
  ).toHaveLength(2);
  // Invited teammates without a WorkOS login yet.
  expect(users.some((u) => u.workos_user_id === null)).toBe(true);
});

it("plants signals worth a dashboard", () => {
  const byCustomer = new Map(subscriptions.map((s) => [s.customer_id, s]));
  const status = (campaign: string) =>
    accounts
      .filter((a) => String(a.signup_campaign_id).toLowerCase() === campaign)
      .map((a) =>
        a.stripe_customer_id
          ? (byCustomer.get(a.stripe_customer_id) as any)?.status
          : "never_paid",
      );
  // The giveaway drives signups that never pay or cancel.
  const giveaway = status("giveaway-q2");
  expect(giveaway.filter((s) => s === "active")).toHaveLength(0);
  expect(giveaway.length).toBeGreaterThanOrEqual(10);
  // Seat expansion and failed payments show up in invoices.
  expect(invoices.some((i) => i.billing_reason === "subscription_update")).toBe(
    true,
  );
  expect(
    invoices.some((i) => i.status === "open" || i.status === "uncollectible"),
  ).toBe(true);
  expect(subscriptions.some((s) => s.status === "past_due")).toBe(true);
  expect(subscriptions.some((s) => s.cancel_at_period_end === true)).toBe(true);
  // Cancelled accounts filed urgent tickets beforehand.
  const cancelled = new Set(
    accounts
      .filter(
        (a) =>
          (byCustomer.get(a.stripe_customer_id) as any)?.status === "canceled",
      )
      .map((a) => a.account_id),
  );
  expect(
    tickets.filter(
      (t) =>
        cancelled.has(t.account_id) &&
        ["high", "urgent"].includes(t.priority as string),
    ).length,
  ).toBeGreaterThan(5);
  // Two cancelled accounts still hold a paid plan in the app.
  expect(
    accounts.filter((a) => cancelled.has(a.account_id) && a.plan !== "free"),
  ).toHaveLength(2);
});

it("stays small enough to ingest quickly", () => {
  const total = samples.reduce((n, d) => n + d.rows.length, 0);
  expect(total).toBeLessThan(8000);
  const columns = samples.reduce(
    (n, d) => n + Object.keys(d.rows[0]).length,
    0,
  );
  expect(columns).toBeLessThanOrEqual(80);
});
