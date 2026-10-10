// Share links: the file travels in the URL fragment (#s=…), which browsers never send to a
// server, so a link works offline and nothing is uploaded anywhere. Opening a link only loads
// the file into the editor; it never runs it.
import type { Draft } from "./draft";

const PREFIX = "#s=";
/** Long links break in chat apps and some browsers; past this, saving the file is the better way. */
export const MAX_LINK_LENGTH = 8000;

/**
 * Runs bytes through a (de)compression stream with explicit reader and writer, so a damaged link
 * fails inside our try/catch. (Through `new Response(stream)`, Firefox also logs the failure.)
 */
async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
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

/** Reads a shared file from a URL fragment; null if there is none or it is damaged. */
export async function readShareHash(hash: string): Promise<Draft | null> {
  if (!hash.startsWith(PREFIX)) return null;
  try {
    const json = new TextDecoder().decode(await pipe(fromBase64Url(hash.slice(PREFIX.length)), new DecompressionStream("deflate-raw")));
    const d = JSON.parse(json) as { v?: number; f?: unknown; c?: unknown; i?: unknown };
    if (d.v !== 1 || typeof d.f !== "string" || typeof d.c !== "string") return null;
    return { filename: d.f, code: d.c, stdin: typeof d.i === "string" ? d.i : "" };
  } catch {
    return null;
  }
}
