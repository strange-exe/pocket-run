import { AxeBuilder } from "@axe-core/playwright";
import { expect, followDeviceTheme, openApp, test } from "./helpers";

// DESIGN.md §6 matrix for the about page: desktop + mobile, light + dark, reduced motion, axe,
// overflow, primary action above the fold, grayscale + blur hierarchy shots.
const viewports = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
];
const shots = process.env.SHOTS_DIR ?? "e2e/shots/after";

/**
 * Opens the about page in a colour scheme. Firefox drops a scheme emulated before the first
 * cross-origin-isolated navigation (see themes.spec.ts), so load, emulate, reload, and check it took.
 */
async function openAbout(page: import("@playwright/test").Page, scheme: "light" | "dark", reducedMotion?: "reduce", beforeReload?: () => void) {
  await followDeviceTheme(page);
  await page.goto("/about/");
  await page.emulateMedia({ colorScheme: scheme, ...(reducedMotion ? { reducedMotion } : {}) });
  // Listeners attached here see only the page under test: the reload itself cancels whatever the first
  // load was still fetching (Firefox reports the 3D backdrop's download as NS_BINDING_ABORTED).
  beforeReload?.();
  await page.reload();
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe(scheme);
}

for (const vp of viewports) {
  for (const scheme of ["light", "dark"] as const) {
    test(`about ${vp.name} ${scheme}`, async ({ page }, testInfo) => {
      const failed: string[] = [];
      await page.setViewportSize(vp);
      await openAbout(page, scheme, undefined, () => {
        // Only requests the page under test starts. The first load can still start one just before the reload
        // replaces it (Firefox, measured: its 3D download began 10 ms before the reload and was cancelled), so
        // counting begins when the new document commits, before it requests anything.
        const ours = new Set<import("@playwright/test").Request>();
        let committed = false;
        page.once("framenavigated", () => { committed = true; });
        page.on("request", (r) => { if (committed) ours.add(r); });
        page.on("requestfailed", (r) => { if (ours.has(r)) failed.push(`${r.url()} ${r.failure()?.errorText}`); });
        page.on("response", (r) => { if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`); });
      });

      // Above the fold: what it is (headline), and the one thing to do next.
      await expect(page.getByRole("heading", { level: 1 })).toBeInViewport();
      await expect(page.locator(".hero").getByRole("link", { name: "Open Pocket Run" })).toBeInViewport();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
      // The phone is drawn in HTML: it has a real phone's proportions (about 9:19.5, never a squat box), shows
      // the app's real phone layout, and wears the current theme (its screen is the app's --paper colour).
      await expect(page.locator(".phone")).toBeVisible();
      const box = (await page.locator(".phone").boundingBox())!;
      expect(box.height / box.width, "phone proportions").toBeGreaterThan(2);
      for (const part of [".sbar", ".m-head", ".m-status", ".m-file", ".m-tools", ".code", ".m-out", ".m-dock .run"]) {
        await expect(page.locator(`.screen ${part}`), part).toBeVisible();
      }
      const [screen, paper] = await page.evaluate(() => {
        const probe = document.createElement("div");
        probe.style.background = "var(--paper)";
        document.body.append(probe);
        const value = [getComputedStyle(document.querySelector(".screen")!).backgroundColor, getComputedStyle(probe).backgroundColor];
        probe.remove();
        return value;
      });
      expect(screen).toBe(paper);

      const dir = `${shots}/${testInfo.project.name}`;
      await page.screenshot({ path: `${dir}/about-${vp.name}-${scheme}.png`, fullPage: true, animations: "disabled" });
      expect(failed).toEqual([]);
    });
  }
}

for (const scheme of ["light", "dark"] as const) {
  test(`about accessibility and hierarchy ${scheme}`, async ({ page }, testInfo) => {
    await openAbout(page, scheme, "reduce");
    const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
    const dir = `${shots}/${testInfo.project.name}`;
    for (const [name, filter] of [["gray", "grayscale(1)"], ["blur", "blur(6px)"]] as const) {
      const tag = await page.addStyleTag({ content: `html{filter:${filter}}` });
      await page.screenshot({ path: `${dir}/about-${scheme}-${name}.png`, animations: "disabled" });
      await tag.evaluate((el) => (el as Element).remove());
    }
  });
}

test("Open Pocket Run goes to the app, and the app links back here", async ({ page }) => {
  await page.goto("/about/");
  await page.locator(".hero").getByRole("link", { name: "Open Pocket Run" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator("#status-dot")).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
  await page.locator(".masthead").getByRole("link", { name: "About Pocket Run" }).click();
  await expect(page).toHaveURL(/\/about\/$/);
});

test("the about page follows the theme chosen in the app", async ({ page }) => {
  await openApp(page);
  await page.locator("#theme-btn").click();
  await page.getByRole("radio", { name: "Dracula" }).check();
  await page.goto("/about/");
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe("dark");
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgb(40, 42, 54)"); // Dracula sheet
});

test("a first visit to the about page gets the default theme, Tokyo Night", async ({ page }) => {
  await page.goto("/about/");
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe("dark");
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgb(26, 27, 38)"); // #1a1b26
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
});

test("the about page works offline", async ({ page, context }) => {
  await openApp(page);
  // The app's own signal that the service worker has precached everything (as in offline.spec.ts).
  await expect(page.locator("#status-text")).toContainText("works offline", { timeout: 60_000 });
  await context.setOffline(true);
  await page.goto("/about/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  // Styled too (the stylesheet came from the cache): the phone is laid out, not bare text.
  expect(await page.locator(".phone").evaluate((el) => getComputedStyle(el).aspectRatio)).toBe("9 / 19.5");
});

// The 3D dot field (src/about-field.ts, ~240 KB) is optional: wide screens only, after load, never with
// reduced motion or offline, and never precached for the app's offline install.
const scriptsOf = (page: import("@playwright/test").Page) => {
  const scripts: string[] = [];
  page.on("request", (r) => { if (r.resourceType() === "script") scripts.push(new URL(r.url()).pathname); });
  return scripts;
};

test.describe("the 3D backdrop", () => {
  test.use({ serviceWorkers: "block" });

  test("on a wide screen it loads after the page, from assets/3d/, hidden from screen readers", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const scripts = scriptsOf(page);
    await page.goto("/about/");
    // It renders where the browser can (WebGPU, else WebGL 2). Where it can't (Firefox on CI's Linux runners has
    // neither), it must give up cleanly: no canvas left behind, no errors, the static backdrop stays.
    const field = page.locator(".field");
    await expect(field).toHaveAttribute("data-state", /^(live|unavailable)$/, { timeout: 20_000 });
    if ((await field.getAttribute("data-state")) === "unavailable") {
      const gpu = await page.evaluate(async () =>
        !!document.createElement("canvas").getContext("webgl2") ||
        !!(await (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu?.requestAdapter()));
      expect(gpu, "gave up although the browser can render 3D").toBe(false);
      await expect(page.locator(".field canvas")).toHaveCount(0);
    } else {
      await expect(page.locator(".field canvas")).toHaveAttribute("aria-hidden", "true");
    }
    expect(scripts[0]).toBe("/theme-boot.js");
    expect(scripts.filter((s) => !/^\/assets\/(3d\/)?[\w-]+\.js$/.test(s) && s !== "/theme-boot.js")).toEqual([]);
    expect(scripts.some((s) => s.startsWith("/assets/3d/"))).toBe(true);
  });

  test("without WebGPU or WebGL 2 it gives up cleanly, keeping the static backdrop", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(() => {
      const getContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
        return type === "webgl2" || type === "webgpu" ? null : (getContext as (...a: unknown[]) => unknown).call(this, type, ...rest);
      } as typeof getContext;
      Object.defineProperty(Navigator.prototype, "gpu", { get: () => undefined, configurable: true });
    });
    await page.goto("/about/");
    await expect(page.locator(".field")).toHaveAttribute("data-state", "unavailable", { timeout: 20_000 });
    await expect(page.locator(".field canvas")).toHaveCount(0);
    await expect(page.locator(".phone")).toBeVisible(); // the console-error check runs on teardown
  });

  for (const [name, setup] of [
    ["on a phone", async (page: import("@playwright/test").Page) => page.setViewportSize({ width: 390, height: 844 })],
    ["with reduced motion", async (page: import("@playwright/test").Page) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
    }],
  ] as const) {
    test(`${name} it is never downloaded`, async ({ page }) => {
      await setup(page);
      const scripts = scriptsOf(page);
      await page.goto("/about/");
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(3500); // past the idle callback's 3 s timeout
      expect(scripts.filter((s) => s.startsWith("/assets/3d/"))).toEqual([]);
      await expect(page.locator(".field canvas")).toHaveCount(0);
    });
  }
});

test("the phone tilts towards a mouse, but not with reduced motion", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/about/");
  const phone = page.locator(".phone");
  const box = (await phone.boundingBox())!;
  const tilt = () => phone.evaluate((el) => (el as HTMLElement).style.getPropertyValue("--tilt-y"));
  await page.mouse.move(box.x + box.width * 0.9, box.y + box.height * 0.2, { steps: 4 });
  expect(parseFloat(await tilt())).toBeGreaterThan(2);
  await page.mouse.move(5, 5); // leaving the stage puts it back
  expect(await tilt()).toBe("");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.mouse.move(box.x + box.width * 0.9, box.y + box.height * 0.2, { steps: 4 });
  expect(await tilt()).toBe("");
});

test("the service worker never precaches the 3D backdrop", async ({ request }) => {
  const sw = await (await request.get("/sw.js")).text();
  expect(sw).toContain("assets/"); // it does list the app's own files
  expect(sw).not.toContain("assets/3d/");
});
