import { describe, expect, it } from "vitest";
import { MAX_LINK_LENGTH, makeShareUrl, readShareHash } from "./share";

const BASE = "https://pocket-run.pages.dev/";

describe("share links", () => {
  it("round-trips the file name, code and input exactly", async () => {
    const draft = { filename: "sum.cpp", code: '#include <iostream>\nint main() { std::cout << "नमस्ते ✓\\n"; }\n', stdin: "3 4\n" };
    const url = await makeShareUrl(draft, BASE);
    expect(url).toMatch(/^https:\/\/pocket-run\.pages\.dev\/#s=[\w-]+$/);
    expect(await readShareHash(new URL(url!).hash)).toEqual(draft);
  });

  it("replaces an existing fragment instead of appending to it", async () => {
    const url = await makeShareUrl({ filename: "a.py", code: "print(1)", stdin: "" }, `${BASE}#s=old`);
    expect(url!.match(/#/g)).toHaveLength(1);
  });

  it("refuses files too long for a link", async () => {
    // Random text barely compresses, so this stays far over the limit.
    const code = Array.from({ length: 20000 }, () => String.fromCharCode(33 + Math.floor(Math.random() * 90))).join("");
    expect(await makeShareUrl({ filename: "big.py", code, stdin: "" }, BASE)).toBeNull();
    expect(MAX_LINK_LENGTH).toBeLessThan(10000);
  });

  it.each(["", "#", "#other", "#s=", "#s=not-valid-data!!", "#s=AAAA"])("ignores %j", async (hash) => {
    expect(await readShareHash(hash)).toBeNull();
  });
});
