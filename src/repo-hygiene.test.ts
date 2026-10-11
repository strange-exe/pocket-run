/// <reference types="node" />
// Pocket Run blocks "Trojan Source" characters in other people's code; its own code must not
// contain them either. Fails if any tracked text file has a direction-control character.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOTS = ["src", "e2e", "scripts", "index.html", "README.md", "vite.config.ts", "playwright.config.ts"];
const TEXT = /\.(ts|mjs|js|html|css|md|json)$/;
const BIDI = new RegExp(`[${[0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069].map((c) => String.fromCodePoint(c)).join("")}]`);

function files(path: string): string[] {
  if (statSync(path).isFile()) return TEXT.test(path) ? [path] : [];
  return readdirSync(path).flatMap((name) => (name === "shots" || name === "vendor" ? [] : files(join(path, name))));
}

describe("repository hygiene", () => {
  it("no source, test or doc file contains direction-control characters", () => {
    const offenders = ROOTS.flatMap(files).filter((f) => BIDI.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
});
