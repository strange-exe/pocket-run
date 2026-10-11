import { describe, expect, it } from "vitest";
import { MAX_LINK_LENGTH, makeShareUrl, readShareHash } from "./share";

const BASE = "https://pocket-run.pages.dev/";

describe("share links", () => {
  it("round-trips the file name, code and input exactly", async () => {
    const draft = { filename: "sum.cpp", code: '#include <iostream>\nint main() { std::cout << "नमस्ते ✓\\n"; }\n', stdin: "3 4\n" };
    const url = await makeShareUrl(draft, BASE);
    expect(url).toMatch(/^https:\/\/pocket-run\.pages\.dev\/#s=[\w-]+$/);
    expect(await readShareHash(new URL(url!).hash)).toEqual({ ok: true, draft });
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

/** Builds a link the way an attacker could, bypassing makeShareUrl's own checks and length limit. */
async function craft(payload: object): Promise<string> {
  const packed = await new Response(
    new Blob([JSON.stringify(payload)]).stream().pipeThrough(new CompressionStream("deflate-raw")),
  ).arrayBuffer();
  let binary = "";
  for (const b of new Uint8Array(packed)) binary += String.fromCharCode(b);
  return "#s=" + btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

describe("received links are checked like opened files", () => {
  const RLO = String.fromCodePoint(0x202e);
  const ZWSP = String.fromCodePoint(0x200b);

  it("blocks a link that inflates far beyond a code file (zip bomb)", async () => {
    const hash = await craft({ v: 1, f: "a.py", c: "#".repeat(10 * 1024 * 1024), i: "" });
    expect(hash.length).toBeLessThan(MAX_LINK_LENGTH * 2); // passes the length check...
    const r = await readShareHash(hash);
    expect(r).toMatchObject({ ok: false, blocked: expect.stringContaining("unpacks to more than") }); // ...stopped while inflating
  });

  it("blocks Trojan Source direction controls in code or input", async () => {
    expect(await readShareHash(await craft({ v: 1, f: "a.py", c: `x = 1 #${RLO} admin`, i: "" }))).toMatchObject({ ok: false });
    expect(await readShareHash(await craft({ v: 1, f: "a.py", c: "print(1)", i: `${RLO}x` }))).toMatchObject({ ok: false });
  });

  it("blocks invisible characters and control characters", async () => {
    expect(await readShareHash(await craft({ v: 1, f: "a.py", c: `is${ZWSP}admin = True`, i: "" }))).toMatchObject({ ok: false });
    expect(await readShareHash(await craft({ v: 1, f: "a.py", c: "print(1)" + String.fromCharCode(7), i: "" }))).toMatchObject({ ok: false });
  });

  it("blocks files that aren't Python, C or C++, after cleaning direction tricks out of the name", async () => {
    // Displays as "mainexe.py" but is really main.exe-something; cleaned, it ends in ".exe".
    const r = await readShareHash(await craft({ v: 1, f: `main${RLO}yp.exe`, c: "x", i: "" }));
    expect(r).toMatchObject({ ok: false });
    if (r && !r.ok) expect(r.blocked).toContain("mainyp.exe");
  });

  it("refuses to create a link for a file with hidden characters", async () => {
    const { shareProblem } = await import("./share");
    expect(shareProblem({ filename: "a.py", code: `x${ZWSP} = 1`, stdin: "" })).toMatch(/invisible/);
    expect(shareProblem({ filename: "a.py", code: `x = 1 #${RLO}`, stdin: "" })).toMatch(/direction/);
    expect(shareProblem({ filename: "a.py", code: "print('नमस्ते')", stdin: "" })).toBeNull();
  });
});
