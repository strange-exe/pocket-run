import { detectLanguage } from "./languages";

/** One code file; anything bigger is not a "quick snippet" and slows phones down. */
export const MAX_FILE_BYTES = 512 * 1024;

export type OpenResult =
  | { ok: true; name: string; text: string }
  | { ok: false; error: string };

export async function readCodeFile(file: File): Promise<OpenResult> {
  if (!detectLanguage(file.name)) {
    return { ok: false, error: `“${file.name}” isn't a Python, C or C++ file (.py, .c, .cpp).` };
  }
  if (file.size > MAX_FILE_BYTES) {
    return { ok: false, error: `“${file.name}” is ${Math.round(file.size / 1024)} KB; the limit is ${MAX_FILE_BYTES / 1024} KB.` };
  }
  const text = await file.text();
  // A NUL byte means this is a binary file that only looks like source by its name.
  if (text.includes("\u0000")) {
    return { ok: false, error: `“${file.name}” looks like a binary file, not source code.` };
  }
  return { ok: true, name: file.name, text: text.replace(/\r\n/g, "\n") };
}

/** Saves to the device's Downloads (works in every mobile browser, no permission prompt). */
export function downloadFile(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Makes a typed name safe to save: no path separators or reserved characters. */
export function sanitizeFilename(name: string): string {
  return name.trim().replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_") || "untitled";
}
