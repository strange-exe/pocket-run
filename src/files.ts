import { detectLanguage } from "./languages";
import { checkBytes, cleanFilename, MAX_FILE_BYTES } from "./safety";

export type OpenResult =
  | { ok: true; name: string; text: string; hidden: number }
  | { ok: false; error: string };

/** Opens a code file from the device. Nothing is uploaded: the file is only read in this tab. */
export async function readCodeFile(file: File): Promise<OpenResult> {
  const name = cleanFilename(file.name);
  if (!detectLanguage(name)) {
    return { ok: false, error: `“${name}” isn't a Python, C or C++ file (.py, .c, .cpp).` };
  }
  // Check the size before reading, so a huge file is never loaded into memory.
  if (file.size > MAX_FILE_BYTES) {
    return { ok: false, error: `“${name}” is ${Math.round(file.size / 1024)} KB; the limit is ${MAX_FILE_BYTES / 1024} KB.` };
  }
  const checked = checkBytes(new Uint8Array(await file.arrayBuffer()));
  if (!checked.ok) return { ok: false, error: `“${name}” wasn't opened: ${checked.reason}.` };
  return { ok: true, name, text: checked.text, hidden: checked.hidden };
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

/** Makes a typed or received name safe to show and save (see cleanFilename). */
export const sanitizeFilename = cleanFilename;
