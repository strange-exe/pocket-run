// Share links: the file travels in the URL fragment (#s=…), which browsers never send to a
// server, so a link works offline and nothing is uploaded anywhere. Opening a link only loads
// the file into the editor; it never runs it.
import type { Draft } from "./draft";
import { detectLanguage } from "./languages";
import { checkText, cleanFilename, MAX_FILE_BYTES } from "./safety";

const PREFIX = "#s=";
/** Long links break in chat apps and some browsers; past this, saving the file is the better way. */
export const MAX_LINK_LENGTH = 8000;

/**
 * Runs bytes through a (de)compression stream with explicit reader and writer, so a damaged link
 * fails inside our try/catch. (Through `new Response(stream)`, Firefox also logs the failure.)
 */
async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream, maxBytes = Infinity): Promise<Uint8Array> {
  const writer = stream.writable.getWriter();
  writer.write(bytes as Uint8Array<ArrayBuffer>).catch(() => {}); // failures surface on the read side
  writer.close().catch(() => {});
  const reader = stream.readable.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    length += value.length;
    // A few KB of link can inflate to many MB (a "zip bomb"): stop as soon as it's too big.
    if (length > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new Error("too large");
    }
  }
  const out = new Uint8Array(length);
  let offset = 0;
  for (const c of chunks) { out.set(c, offset); offset += c.length; }
  return out;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array {
  const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

/** Builds a share URL for this file, or null if it would be too long to share as a link. */
export async function makeShareUrl(draft: Draft, base: string): Promise<string | null> {
  const json = JSON.stringify({ v: 1, f: draft.filename, c: draft.code, i: draft.stdin });
  const packed = await pipe(new TextEncoder().encode(json), new CompressionStream("deflate-raw"));
  const url = `${base.split("#")[0]}${PREFIX}${toBase64Url(packed)}`;
  return url.length <= MAX_LINK_LENGTH ? url : null;
}

/** Why a file can't be shared as a link, or null if it can. */
export function shareProblem(draft: Draft): string | null {
  for (const text of [draft.code, draft.stdin]) {
    const checked = checkText(text);
    if (!checked.ok) return `This file can't be shared: ${checked.reason}.`;
    if (checked.hidden) return `This file has ${checked.hidden} invisible character${checked.hidden === 1 ? "" : "s"} that could hide what the code does. Remove them before sharing.`;
  }
  return null;
}

export type SharedFile = { ok: true; draft: Draft } | { ok: false; blocked: string };

/**
 * Reads a shared file from a URL fragment: null if there is none or it is damaged, or the reason it
 * was blocked. Shared links come from other people, so they get the same checks as opened files.
 */
export async function readShareHash(hash: string): Promise<SharedFile | null> {
  if (!hash.startsWith(PREFIX)) return null;
  if (hash.length > MAX_LINK_LENGTH * 2) return { ok: false, blocked: "the link is far longer than any Pocket Run link" };
  let d: { v?: number; f?: unknown; c?: unknown; i?: unknown };
  try {
    const bytes = await pipe(fromBase64Url(hash.slice(PREFIX.length)), new DecompressionStream("deflate-raw"), MAX_FILE_BYTES + 64 * 1024);
    d = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch (e) {
    if ((e as Error).message === "too large") return { ok: false, blocked: `it unpacks to more than ${MAX_FILE_BYTES / 1024} KB` };
    return null;
  }
  if (d.v !== 1 || typeof d.f !== "string" || typeof d.c !== "string") return null;
  const draft = { filename: cleanFilename(d.f), code: d.c, stdin: typeof d.i === "string" ? d.i : "" };
  if (!detectLanguage(draft.filename)) return { ok: false, blocked: `“${draft.filename}” isn't a Python, C or C++ file` };
  for (const text of [draft.code, draft.stdin]) {
    const checked = checkText(text);
    if (!checked.ok) return { ok: false, blocked: checked.reason };
    if (checked.hidden) return { ok: false, blocked: "it contains invisible characters that could hide what the code does" };
  }
  return { ok: true, draft };
}
