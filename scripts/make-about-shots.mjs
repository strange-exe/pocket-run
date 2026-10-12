// Renders the about page's app screenshots (phone size, light and dark) from the real, built app.
// Run after `npm run build`: node scripts/make-about-shots.mjs
// Runs Vite's preview server in this process (so closing it really stops it) on a spare port.
// WebP is encoded by the browser's canvas, so no image tooling is needed.
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";
import { preview } from "vite";

const PORT = 4329;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const CODE = [
  'name = input("Name: ")',
  "marks = [78, 91, 85]",
  "avg = sum(marks) / len(marks)",
  'print(f"Hi {name}, average {avg:.1f}")',
  "",
].join("\n");

const server = await preview({ preview: { host: "127.0.0.1", port: PORT, strictPort: true }, logLevel: "warn" });
try {
  await mkdir("public/about", { recursive: true });
  const browser = await chromium.launch();
  for (const scheme of ["light", "dark"]) {
    const context = await browser.newContext({ viewport: { width: 390, height: 860 }, deviceScaleFactor: 2, colorScheme: scheme });
    const page = await context.newPage();
    await page.goto(ORIGIN);
    await page.locator('#status-dot[data-state="ready"]').waitFor({ timeout: 60_000 });
    await page.locator("#file-input").setInputFiles({ name: "average.py", mimeType: "text/plain", buffer: Buffer.from(CODE) });
    await page.locator("#stdin-box").evaluate((d) => { d.open = true; }); // may already be open: don't toggle
    await page.locator("#stdin").fill("Abhinesh\n");
    await page.locator("#stdin-box").evaluate((d) => { d.open = false; }); // still used; frees room for Output
    await page.locator("#run-btn").click();
    await page.locator('#receipt[data-status="ok"]').waitFor();
    await page.evaluate(() => scrollTo(0, 0));
    await page.waitForTimeout(400); // let the output fade-in finish
    const png = await page.screenshot({ animations: "disabled" });
    const webp = await page.evaluate(async (b64) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const canvas = Object.assign(document.createElement("canvas"), { width: img.width, height: img.height });
      canvas.getContext("2d").drawImage(img, 0, 0);
      return canvas.toDataURL("image/webp", 0.82).split(",")[1];
    }, png.toString("base64"));
    const out = `public/about/app-${scheme}.webp`;
    await writeFile(out, Buffer.from(webp, "base64"));
    console.log(`${out}: ${Math.round(Buffer.from(webp, "base64").length / 1024)} KB`);
    await context.close();
  }
  await browser.close();
} finally {
  await server.close();
}
