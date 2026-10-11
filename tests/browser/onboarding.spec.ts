import { test, expect } from "@playwright/test";
import { customerRows, orderRows } from "../fixtures-reference";
import { artifact, ports } from "./support/ports";
import { openApp } from "./support/workspace";
test("sample data highlights its sources, loads behind the AI scene, and builds and opens a workspace from the suggested ontology", async ({
  page,
}) => {
  await openApp(page);
  const workspace = await page.request
    .post("/api/v1/workspaces", { data: { name: "Sample onboarding" } })
    .then((r) => r.json());
  const base = `/api/v1/workspaces/${workspace.id}`;
  const onboarding = () =>
    page.request.get(base + "/onboarding").then((r) => r.json());
  // The deterministic local provider describes the suggestion and builds the view.
  expect(
    (
      await page.request.post(base + "/onboarding/provider", {
        data: { provider: "local", model: "qwen3:4b" },
      })
    ).ok(),
  ).toBe(true);
  const samples = await page.request
    .post(base + "/demo", { data: {} })
    .then((r) => r.json());
  await page.request.patch(base + "/onboarding", {
    data: { step: "data", excludedIds: samples.datasets.map((d: any) => d.id) },
  });
  await expect
    .poll(async () => (await onboarding()).providerReady, { timeout: 30000 })
    .toBe(true);
  await page.evaluate(
    (id) => localStorage.setItem("foundry.workspace", id),
    workspace.id,
  );
  await page.goto("/onboarding");
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/demo", async (route) => {
    await held;
    await route.continue();
  });
  const sampleCards = [
    "WorkOS",
    "PostHog",
    "PlanetScale",
    "Stripe",
    "Blob storage",
  ];
  try {
    await page
      .getByRole("button", { name: "Continue with sample data", exact: true })
      .click();
    await expect(page.getByRole("status")).toContainText("Loading sample data");
    for (const name of sampleCards)
      await expect(page.getByRole("button", { name, exact: true })).toHaveClass(
        /highlighted/,
      );
    await expect(
      page.getByRole("button", { name: "MySQL", exact: true }),
    ).not.toHaveClass(/highlighted/);
    // The Outcome page opens after the highlight, without waiting for the samples.
    await expect(
      page.getByRole("heading", { name: "Understanding your data" }),
    ).toBeVisible();
    await expect(
      page.getByRole("img", { name: /^AI is reading/ }),
    ).toBeVisible();
    await expect(page.locator(".feed-step.is-active")).toHaveText(
      /Reading your tables/,
    );
    await expect(page.locator(".setup-content .error-box")).toHaveCount(0);
  } finally {
    release();
  }
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Here’s how your data fits together" }),
  ).toBeVisible({ timeout: 30000 });
  await expect(
    page.getByRole("heading", { name: "Does this look right?" }),
  ).toBeVisible();
  const account = page.locator(".so-node").filter({
    has: page.getByRole("heading", { name: "Account", exact: true }),
  });
  await expect(
    account.getByRole("button", { name: "Merged from 3 sources" }),
  ).toBeVisible();
  await expect(
    page.getByRole("checkbox", { name: "Include Event" }),
  ).toBeChecked();
  // The AI description run finishes behind the scene and updates the suggestion.
  await expect
    .poll(async () => (await onboarding()).ontology?.described, {
      timeout: 30000,
    })
    .toBe(true);
  await expect(page.getByText("AI is still writing descriptions")).toHaveCount(
    0,
  );
  const final = await onboarding();
  expect(final.step).toBe("outcome");
  expect(final.sampleProgress).toBeUndefined();
  expect(final.datasets.map((d: any) => d.id).sort()).toEqual(
    samples.datasets.map((d: any) => d.id).sort(),
  );
  // Polls are held so the build screen can be checked before it redirects.
  let releasePolls!: () => void;
  const heldPolls = new Promise<void>((resolve) => {
    releasePolls = resolve;
  });
  const polls = (url: URL) => url.pathname === base + "/onboarding";
  await page.route(polls, async (route) => {
    if (route.request().method() === "GET") await heldPolls;
    await route.continue();
  });
  try {
    await page
      .getByRole("button", { name: "Looks right — build my workspace" })
      .click();
    await expect(
      page.getByRole("heading", { name: "Building your workspace" }),
    ).toBeVisible();
    await expect(
      page.getByRole("img", { name: /^AI is building your workspace/ }),
    ).toBeVisible();
    await expect(page.locator(".setup-steps [aria-current=step]")).toHaveText(
      /Ontology/,
    );
    await expect(page.locator(".setup-steps > span")).toHaveCount(3);
    const confirmed = await onboarding();
    expect(confirmed.step).toBe("review");
    expect(confirmed.ontologyConfirmed).toBe(true);
    expect(confirmed.buildRun).toBeTruthy();
  } finally {
    releasePolls();
  }
  // No review page: the build publishes itself and setup opens Home, with
  // its key metrics.
  await expect(page).toHaveURL("/", { timeout: 60000 });
  await page.unroute(polls);
  const keyMetrics = page.getByRole("region", { name: "Key metrics" });
  await expect(keyMetrics).toBeVisible();
  await expect(
    keyMetrics.getByRole("heading", { name: "Key metrics" }),
  ).toBeVisible();
  // The sample data has dates and money columns, so there are metrics to show.
  const homeMetrics = await page.request
    .get(base + "/home/metrics")
    .then((r) => r.json());
  expect(homeMetrics.status).toBe("ready");
  expect(homeMetrics.metrics.length).toBeGreaterThan(0);
  const published = await onboarding();
  expect(published.complete).toBe(true);
  expect(published.buildRun.data.status).toBe("succeeded");
  expect(published.proposal.data.status).toBe("published");
});
test("complete resumable onboarding, full REST import, suggested ontology and automatic publication", async ({
  page,
}) => {
  await openApp(page);
  // No accounts: the first visit opens setup for this computer's workspace,
  // with no sign-in form on the way.
  await expect(page).toHaveURL(/\/onboarding$/);
  await expect(
    page.getByRole("heading", { name: "A little help with your data" }),
  ).toBeVisible();
  await expect(page.getByLabel("Email", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Password", { exact: true })).toHaveCount(0);
  const w = await page.request
    .post("/api/v1/workspaces", { data: { name: "Onboarding acceptance" } })
    .then((r) => r.json());
  await page.evaluate(
    (id) => localStorage.setItem("foundry.workspace", id),
    w.id,
  );
  await page.goto("/onboarding");
  await expect(
    page.getByRole("heading", { name: "A little help with your data" }),
  ).toBeVisible();
  await page.getByText("Claude", { exact: true }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByLabel("API key", { exact: true })).toBeFocused();
  await expect(
    page.getByRole("heading", { name: "A little help with your data" }),
  ).toBeVisible();
  await page.getByText("OpenAI", { exact: true }).click();
  await expect(page.getByLabel("API key", { exact: true })).toHaveAttribute(
    "required",
    "",
  );
  await page.getByText("Local", { exact: true }).click();
  await expect(
    page.getByText("Advanced settings", { exact: true }),
  ).toHaveCount(0);
  await page.screenshot({
    path: artifact("onboarding-ai-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("radio", { name: /Local/ })).toBeChecked();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: artifact("onboarding-ai-mobile.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1040 });
  let releaseSave!: () => void;
  const heldSave = new Promise<void>((resolve) => {
    releaseSave = resolve;
  });
  await page.route("**/onboarding/provider", async (route) => {
    await heldSave;
    await route.fulfill({
      status: 503,
      json: { error: "Connection interrupted" },
    });
  });
  try {
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Where is your data?" }),
    ).toBeVisible({ timeout: 1000 });
    await expect(
      page.getByRole("button", { name: "Neon", exact: true }),
    ).toBeEnabled();
    await expect(page.getByText("Prepare local", { exact: true })).toHaveCount(
      0,
    );
  } finally {
    releaseSave();
  }
  await expect(page.getByRole("alert")).toContainText(
    "We couldn’t save your AI choice",
  );
  await page.unroute("**/onboarding/provider");
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Save and finish later" }),
  ).toHaveCount(0);
  await expect(page.locator(".setup-header")).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Where is your data?" }),
  ).toBeVisible();
  await page.screenshot({
    path: artifact("onboarding-data-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: artifact("onboarding-data-mobile.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1040 });
  await page.getByRole("button", { name: "Neon", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "Neon", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("API key", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Get an API key", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "PlanetScale", exact: true }).click();
  const hostingDialog = page.getByRole("dialog", {
    name: "PlanetScale",
    exact: true,
  });
  await expect(
    hostingDialog.getByLabel("Service token ID", { exact: true }),
  ).toBeVisible();
  await expect(
    hostingDialog.getByLabel("Service token", { exact: true }),
  ).toHaveAttribute("type", "password");
  await expect(
    hostingDialog.getByRole("button", { name: "Connect account", exact: true }),
  ).toBeDisabled();
  await expect(
    hostingDialog.getByRole("link", {
      name: "Get a service token",
      exact: true,
    }),
  ).toHaveAttribute("href", "https://planetscale.com/docs/api/service-tokens");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: artifact("onboarding-planetscale-mobile.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1040 });
  await page.screenshot({
    path: artifact("onboarding-planetscale-desktop.png"),
    fullPage: true,
  });
  let tokenAttempts = 0;
  await page.route("**/hosting/planetscale/token", async (route) => {
    expect(route.request().postDataJSON()).toEqual({
      serviceTokenId: "test-service-id",
      serviceToken: "test-service-token",
    });
    tokenAttempts++;
    await route.fulfill(
      tokenAttempts === 1
        ? {
            status: 502,
            json: {
              error: "Check the service token permissions and try again.",
            },
          }
        : {
            json: {
              account: { id: "test-provider-account", name: "PlanetScale" },
            },
          },
    );
  });
  await page.route("**/hosting/planetscale/options", async (route) => {
    const body = route.request().postDataJSON();
    expect(body.accountId).toBe("test-provider-account");
    await route.fulfill({
      json: body.path.length
        ? {
            title: "Choose a database",
            options: [{ id: "shop", name: "Shop" }],
          }
        : {
            title: "Choose an organization",
            options: [{ id: "acme", name: "Acme" }],
          },
    });
  });
  await hostingDialog
    .getByLabel("Service token ID", { exact: true })
    .fill("test-service-id");
  await hostingDialog
    .getByLabel("Service token", { exact: true })
    .fill("test-service-token");
  await hostingDialog
    .getByRole("button", { name: "Connect account", exact: true })
    .click();
  await expect(hostingDialog.getByRole("alert")).toContainText(
    "Check the service token permissions",
  );
  await hostingDialog
    .getByRole("button", { name: "Connect account", exact: true })
    .click();
  await expect(
    hostingDialog.getByRole("heading", { name: "Choose an organization" }),
  ).toBeVisible();
  await hostingDialog
    .getByRole("button", { name: "Acme", exact: true })
    .click();
  await expect(
    hostingDialog.getByRole("heading", { name: "Choose a database" }),
  ).toBeVisible();
  await hostingDialog
    .getByRole("button", { name: "Connect another account", exact: true })
    .click();
  await expect(
    hostingDialog.getByLabel("Service token", { exact: true }),
  ).toHaveValue("");
  await expect(
    hostingDialog.getByLabel("Service token ID", { exact: true }),
  ).toHaveValue("");
  await page.keyboard.press("Escape");
  await page.unroute("**/hosting/planetscale/token");
  await page.unroute("**/hosting/planetscale/options");
  await page.getByRole("button", { name: "PostgreSQL", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "PostgreSQL", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /All sources/ })).toHaveCount(
    0,
  );
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "PostgreSQL", exact: true }),
  ).toBeFocused();
  await expect(
    page.getByRole("button", { name: "PostgreSQL", exact: true }),
  ).toHaveAccessibleDescription(/None added/);
  await page.getByRole("button", { name: "Upload files", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "Upload files", exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: artifact("onboarding-upload-modal-mobile.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1040 });
  await page.getByLabel("Choose files").setInputFiles([
    {
      name: "Customers.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(customerRows)),
    },
  ]);
  await page.getByRole("button", { name: "Import files", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Upload files", exact: true }),
  ).toHaveAccessibleDescription(/1 added/);
  await page.getByRole("button", { name: "Upload files", exact: true }).click();
  await expect(
    page.getByText("Customers · 2 records", { exact: true }),
  ).toBeVisible({ timeout: 30000 });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "REST API", exact: true }).click();
  await page.getByLabel("Connection name").fill("Orders");
  await page
    .getByLabel("Endpoint URL")
    .fill(`http://127.0.0.1:${ports.api}/fixture/orders`);
  await page.getByLabel("Pagination", { exact: true }).selectOption("offset");
  await page.getByText("Pagination settings", { exact: true }).click();
  await page.getByLabel("Page size", { exact: true }).fill("2");
  await page
    .getByRole("button", { name: "Test connection", exact: true })
    .click();
  await page.getByRole("button", { name: "Import data", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "REST API", exact: true }),
  ).toHaveAccessibleDescription(/1 added/);
  await page.getByRole("button", { name: "REST API", exact: true }).click();
  await expect(
    page.getByText("Orders · 3 records", { exact: true }),
  ).toBeVisible({ timeout: 30000 });
  await page
    .getByRole("button", { name: "Add another connection", exact: true })
    .click();
  await page.getByLabel("Connection name").fill("Second orders connection");
  await page
    .getByLabel("Endpoint URL")
    .fill(`http://127.0.0.1:${ports.api}/fixture/orders`);
  await page
    .getByRole("button", { name: "Test connection", exact: true })
    .click();
  await page.getByRole("button", { name: "Import data", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "REST API", exact: true }),
  ).toHaveAccessibleDescription(/2 added/);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "REST API", exact: true }),
  ).toHaveAccessibleDescription(/2 added/);
  await page.getByRole("button", { name: "REST API", exact: true }).click();
  await page
    .locator(".connection-entry")
    .filter({
      has: page.locator(".connection-entry-heading strong", {
        hasText: "Second orders connection",
      }),
    })
    .getByRole("button", { name: "Remove", exact: true })
    .click();
  await expect(page.locator(".connection-entry")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "REST API", exact: true }),
  ).toHaveAccessibleDescription(/1 added/);
  await expect(
    page.getByText("Removed from setup", { exact: true }),
  ).toHaveCount(0);
  await page.screenshot({
    path: artifact("onboarding-data-added-desktop.png"),
    fullPage: true,
  });
  await page.goto("/");
  await expect(page).toHaveURL(/\/onboarding$/);
  // Old dashboard links go Home, which sends an unfinished workspace to setup.
  await page.goto("/dashboards");
  await expect(page).toHaveURL(/\/onboarding$/);
  await page.goto("/dashboards/unpublished");
  await expect(page).toHaveURL(/\/onboarding$/);
  await expect(
    page.getByRole("button", { name: "REST API", exact: true }),
  ).toHaveAccessibleDescription(/1 added/);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Understanding your data" }),
  ).toBeVisible();
  await expect(page.getByRole("img", { name: /^AI is/ })).toBeVisible();
  await expect(page.locator(".feed-item")).toHaveCount(2);
  await expect(
    page.getByRole("heading", { name: "Here’s how your data fits together" }),
  ).toBeVisible({ timeout: 30000 });
  await expect(
    page.getByRole("checkbox", { name: "Include Customer" }),
  ).toBeChecked();
  await expect(
    page.getByRole("checkbox", { name: "Include Order" }),
  ).toBeChecked();
  await expect(
    page.locator(".so-stats").getByText(/2 tables from 2 sources/),
  ).toBeVisible();
  await page.screenshot({
    path: artifact("onboarding-ontology-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.setViewportSize({ width: 1440, height: 1040 });
  // A reload shows the existing suggestion straight away.
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Here’s how your data fits together" }),
  ).toBeVisible({ timeout: 2000 });
  await expect(page.getByText("AI is still writing descriptions")).toHaveCount(
    0,
    { timeout: 30000 },
  );
  await Promise.all([
    page.waitForResponse((r) =>
      r.url().endsWith("/onboarding/ontology/confirm"),
    ),
    page
      .getByRole("button", { name: "Looks right — build my workspace" })
      .click(),
  ]);
  // Setup resumes the build after a reload and opens Home, with its key
  // metrics.
  await page.reload();
  await expect(page).toHaveURL("/", { timeout: 60000 });
  await expect(page.getByRole("region", { name: "Key metrics" })).toBeVisible();
  const nav = page.getByRole("navigation", { name: "Main navigation" });
  // Setup's own AI runs are not chats: the history under Analyst is empty.
  await expect(nav.getByText("Ask on Home to start a chat")).toBeVisible();
  await nav.getByRole("link", { name: "Ontology", exact: true }).click();
  await nav.getByRole("link", { name: "Explorer", exact: true }).click();
  await page.getByRole("radio", { name: "Table" }).click();
  await page
    .getByRole("list", { name: "Object types" })
    .getByRole("button", { name: /^Order\b/ })
    .click();
  await page.getByRole("row", { name: /^Order 1\b/ }).click();
  await expect(
    page.getByRole("dialog").getByRole("link", { name: /Customer A/ }),
  ).toBeVisible();
});
