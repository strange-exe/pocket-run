// Renders the PWA icons from the logo with Playwright's Chromium.
// Run after changing the logo: node scripts/make-icons.mjs
import { mkdir } from "node:fs/promises";
import { chromium } from "@playwright/test";

const sheet = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <path d="M8 5h12l5 5v17H8z" fill="#FBFAF6" stroke="#1D1B16" stroke-width="2.2" stroke-linejoin="round"/>
  <path d="M14 13l6.5 4-6.5 4z" fill="#C2410C"/></svg>`;

// "maskable" icons get cropped to a circle or squircle, so the mark must sit inside the central 80%.
const icons = [
  { file: "icon-192.png", size: 192, scale: 0.86 },
  { file: "icon-512.png", size: 512, scale: 0.86 },
  { file: "icon-maskable-512.png", size: 512, scale: 0.62 },
];

await mkdir("public/icons", { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage();
for (const { file, size, scale } of icons) {
  const inner = Math.round(size * scale);
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<body style="margin:0;width:${size}px;height:${size}px;display:grid;place-items:center;background:#F4F1EA">
    <div style="width:${inner}px;height:${inner}px">${sheet.replace("<svg ", `<svg width="${inner}" height="${inner}" `)}</div></body>`);
  await page.screenshot({ path: `public/icons/${file}` });
  console.log(`public/icons/${file}`);
}
await browser.close();
