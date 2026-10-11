import { test, expect } from "@playwright/test";
import { api, openApp, sampleWorkspace } from "./support/workspace";

test("workspace shell: navigation, search, setup gate and errors", async ({
  page,
}) => {
  await openApp(page);
  // An unfinished workspace sends every workspace route to setup.
  const fresh = await api(page, "/workspaces", {
    name: "Shell setup " + Date.now(),
  });
  await page.evaluate(
    (id) => localStorage.setItem("foundry.workspace", id),
    fresh.id,
  );
  for (const path of ["/ontology", "/analyst", "/"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/onboarding$/);
  }
  // Data stays open: setup sends people to a dataset to accept a schema change.
  const dataset = await api(page, `/workspaces/${fresh.id}/ingest`, {
    name: "Gate check",
    rows: [{ id: 1, name: "A" }],
  });
  await page.goto(`/data/datasets/${dataset.id}`);
  await expect(
    page.getByRole("heading", { name: "Gate check", exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/data/datasets/${dataset.id}$`));
  await page.goto("/data");
  await expect(page).toHaveURL(/\/data$/);
  const ws = await sampleWorkspace(page, "Shell " + Date.now());
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "Main navigation" });
  // Ontology second, then Data and Analyst.
  const sections = ["Home", "Ontology", "Data", "Analyst"];
  for (const label of sections)
    await expect(
      nav.getByRole("link", { name: label, exact: true }),
    ).toBeVisible();
  expect(
    (await nav.locator(".hf-nav-link").allInnerTexts()).map((t) => t.trim()),
  ).toEqual(sections);
  // Settings sits in the sidebar footer beside the Preferences menu, which
  // names this computer rather than a signed-in person.
  const footer = page.locator(".hf-sidebar-foot");
  await expect(footer.getByRole("link", { name: "Settings" })).toBeVisible();
  const preferences = footer.getByRole("button", {
    name: "Preferences",
    exact: true,
  });
  await expect(preferences).toContainText("This computer");
  await preferences.click();
  const preferencesMenu = page.getByRole("menu", { name: "Preferences" });
  await expect(
    preferencesMenu.getByRole("menuitem", { name: "Settings" }),
  ).toBeVisible();
  await expect(
    preferencesMenu.getByRole("menuitem", { name: "Sign out" }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(preferencesMenu).toHaveCount(0);
  // SQL, Pipelines, Activity and Dashboards were removed, along with the live
  // activity tray; Home's key metrics replace dashboards.
  for (const label of ["Pipelines", "Activity", "SQL", "Dashboards"])
    await expect(
      nav.getByRole("link", { name: label, exact: true }),
    ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /^Live activity/ }),
  ).toHaveCount(0);
  await expect(
    nav.getByRole("link", { name: "Home", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  // The greeting names no one: there are no accounts.
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    /^Good (morning|afternoon|evening)$/,
  );
  await expect(
    page.getByRole("region", { name: "Workspace health" }),
  ).toContainText("Connections");
  await expect(
    page.locator(".wk-types").getByRole("link", { name: /^Account/ }),
  ).toBeVisible();

  // Ontology opens on its Explorer, listed above Object types; nested routes
  // keep their section active.
  await nav.getByRole("link", { name: "Ontology", exact: true }).click();
  await expect(page).toHaveURL(/\/ontology\/explore$/);
  await expect(nav.locator(".hf-subnav a")).toHaveText([
    "Explorer",
    "Object types",
  ]);
  await expect(
    nav.getByRole("link", { name: "Ontology", exact: true }),
  ).toHaveClass(/is-active/);
  await expect(
    nav.getByRole("link", { name: "Explorer", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  // Data is one page of connections and their tables; the old URL lands there.
  await page.goto("/data/connections");
  await expect(page).toHaveURL(/\/data$/);
  await expect(
    page.getByRole("heading", { name: "Data", level: 1 }),
  ).toBeVisible();
  await expect(nav.getByRole("link", { name: "Connections" })).toHaveCount(0);

  // Command palette: search resources, then keyboard navigation.
  await page.keyboard.press("ControlOrMeta+k");
  const palette = page.getByRole("dialog", { name: "Search your workspace" });
  await expect(palette).toBeVisible();
  await palette.getByRole("combobox").fill("account");
  await palette
    .getByRole("group", { name: "Object types" })
    .getByRole("option", { name: /^Account/ })
    .click();
  await expect(page).toHaveURL(/\/ontology\/types\//);
  await expect(
    page.getByRole("heading", { name: "Account", exact: true }),
  ).toBeVisible();
  await expect(
    nav.getByRole("link", { name: "Ontology", exact: true }),
  ).toHaveClass(/is-active/);
  await page.keyboard.press("ControlOrMeta+k");
  await palette.getByRole("combobox").fill("analyst");
  await expect(palette.getByRole("option").first()).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.keyboard.press("Enter");
  // Analyst has no landing page: with no chats yet it opens Home, where
  // chats start, and the history under Analyst says so.
  await expect(page).toHaveURL(/\/$/);
  await expect(palette).toHaveCount(0);
  await expect(nav.getByText("Ask on Home to start a chat")).toBeVisible();
  // Asking from search starts a chat as well: the chat opens and heads the
  // history, marked as the current page. Chats are not section links.
  const question = "Which accounts have the most events?";
  await page.keyboard.press("ControlOrMeta+k");
  await palette.getByRole("combobox").fill(question);
  await palette.getByRole("option", { name: /^Ask Analyst:/ }).click();
  await expect(page).toHaveURL(/\/analyst\/[^/]+$/);
  await expect(palette).toHaveCount(0);
  const chats = nav.getByRole("list", { name: "Chats" });
  await expect(chats.getByRole("link", { name: question })).toHaveAttribute(
    "aria-current",
    "page",
  );
  expect(
    (await nav.locator(".hf-nav-link").allInnerTexts()).map((t) => t.trim()),
  ).toEqual(sections);
  // Search finds the chat by its question.
  await page.keyboard.press("ControlOrMeta+k");
  await palette.getByRole("combobox").fill("accounts have the most");
  await expect(
    palette
      .getByRole("group", { name: "Chats" })
      .getByRole("option", { name: new RegExp("^" + question.slice(0, -1)) }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(palette).toHaveCount(0);
  // New chat returns to Home's ask box, ready to type.
  await nav.getByRole("link", { name: "New chat", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(
    page.getByRole("textbox", { name: "Ask anything about your data" }),
  ).toBeFocused();
  // Dashboards are gone from search; old dashboard links open Home.
  await page.keyboard.press("ControlOrMeta+k");
  await palette.getByRole("combobox").fill("dashboards");
  await expect(
    palette.getByRole("option", { name: /^Dashboards/ }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(palette).toHaveCount(0);

  // Unknown routes and old paths.
  await page.goto("/nowhere");
  await expect(page.getByText("We couldn’t find that page")).toBeVisible();
  for (const old of ["/advanced", "/pipelines", "/explore"]) {
    await page.goto(old);
    await expect(page).toHaveURL(/\/data$/);
  }
  for (const old of ["/activity", "/dashboards", "/dashboards/Overview"]) {
    await page.goto(old);
    await expect(page).toHaveURL(/\/$/);
  }
  await page.goto("/records?type=Account");
  await expect(page).toHaveURL(/\/ontology\/explore\?type=Account$/);

  // The collapsed sidebar keeps accessible names and survives a reload.
  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  await expect(
    nav.getByRole("link", { name: "Data", exact: true }),
  ).toBeVisible();
  await page.reload();
  // Menus open beside the 60px rail, fully visible rather than clipped.
  await page.getByRole("button", { name: /^Workspace:/ }).click();
  const switcher = page.getByRole("menu", { name: /^Workspace:/ });
  await expect(switcher).toBeVisible();
  expect(
    await switcher.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const inside = (x: number, y: number) =>
        el.contains(document.elementFromPoint(x, y));
      return (
        r.width >= 220 &&
        r.left >= 0 &&
        r.right <= window.innerWidth &&
        inside(r.left + 4, r.top + 4) &&
        inside(r.right - 4, r.top + 4) &&
        inside(r.right - 4, r.bottom - 4)
      );
    }),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await expect(switcher).toHaveCount(0);
  await page.getByRole("button", { name: "Expand sidebar" }).click();

  // The workspace switcher lists workspaces and creates new ones.
  await page.getByRole("button", { name: /^Workspace:/ }).click();
  const menu = page.getByRole("menu", { name: /^Workspace:/ });
  await expect(
    menu.getByRole("menuitemradio", { name: new RegExp(ws.name) }),
  ).toHaveAttribute("aria-checked", "true");
  await menu.getByRole("menuitem", { name: "Create workspace" }).click();
  const create = page.getByRole("dialog", { name: "Create a workspace" });
  await create.getByLabel("Workspace name").fill("Shell created");
  await create.getByRole("button", { name: "Create workspace" }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
  await page.evaluate(
    (id) => localStorage.setItem("foundry.workspace", id),
    ws.id,
  );

  // Phone layout: drawer navigation, no sideways scrolling.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(
    page.getByRole("textbox", { name: "Ask anything about your data" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Open navigation" }).click();
  const drawer = page.getByRole("dialog", { name: "Navigation" });
  // A visible close control takes focus; the drawer spans the full height.
  const close = drawer.getByRole("button", { name: "Close navigation" });
  await expect(close).toBeFocused();
  expect(
    await drawer.evaluate(
      (el) => el.getBoundingClientRect().bottom >= window.innerHeight - 1,
    ),
  ).toBe(true);
  await close.click();
  await expect(drawer).toHaveCount(0);
  await page.getByRole("button", { name: "Open navigation" }).click();
  await drawer.getByRole("link", { name: "Ontology", exact: true }).click();
  await expect(page).toHaveURL(/\/ontology\/explore$/);
  await expect(drawer).toHaveCount(0);
});
