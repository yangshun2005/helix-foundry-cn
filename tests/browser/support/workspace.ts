// Shared browser-test setup: open the isolated app and build a finished
// workspace from the sample data (demo -> ontology -> confirm -> published).
import { expect, type Page } from "@playwright/test";

// No sign-in: the first request sets up this computer's person and a workspace.
// Specs run in any order, so this works whether or not that already happened.
export async function openApp(page: Page) {
  const me = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === "/api/v1/me" &&
      r.request().method() === "GET",
  );
  await page.goto("/");
  expect((await me).status()).toBe(200);
  // The app then remembers a workspace. Wait for that write so a test's own
  // choice of workspace is not overwritten by it.
  await page.waitForFunction(() => !!localStorage.getItem("foundry.workspace"));
}

export async function api(page: Page, path: string, data?: unknown) {
  const response =
    data === undefined
      ? await page.request.get("/api/v1" + path)
      : await page.request.post("/api/v1" + path, { data });
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}

// A published workspace built from the sample data; selected in the browser.
export async function sampleWorkspace(page: Page, name: string) {
  const workspace = await api(page, "/workspaces", { name });
  const base = `/workspaces/${workspace.id}`;
  await api(page, base + "/onboarding/provider", {
    provider: "local",
    model: "qwen3:4b",
  });
  await api(page, base + "/demo", { advance: true });
  await expect
    .poll(
      async () => {
        const s = await api(page, base + "/onboarding");
        return s.providerReady && !s.sampleProgress;
      },
      { timeout: 60000, intervals: [1000] },
    )
    .toBe(true);
  const state = await api(page, base + "/onboarding/ontology", {});
  await api(page, base + "/onboarding/ontology/confirm", {
    hash: state.ontology.hash,
    excluded: [],
    names: {},
  });
  await expect
    .poll(async () => (await api(page, base + "/onboarding")).complete, {
      timeout: 90000,
      intervals: [1000],
    })
    .toBe(true);
  await page.evaluate(
    (id) => localStorage.setItem("foundry.workspace", id),
    workspace.id,
  );
  return { id: workspace.id as string, name, base };
}
