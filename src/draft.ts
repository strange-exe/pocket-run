// The current file is kept in localStorage so a closed tab or a reload on a
// flaky connection never loses a student's work. Storage can be unavailable
// (private mode, blocked site data), so every access is guarded.

export interface Draft {
  filename: string;
  code: string;
  stdin: string;
}

const KEY = "pocket-run:draft";
/** The student's own file, kept aside when a share link replaces it. */
export const PREVIOUS_KEY = "pocket-run:draft:previous";

export function loadDraft(key = KEY): Draft | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const d = JSON.parse(raw) as Partial<Draft>;
    if (typeof d.filename !== "string" || typeof d.code !== "string") return null;
    return { filename: d.filename, code: d.code, stdin: typeof d.stdin === "string" ? d.stdin : "" };
  } catch {
    return null;
  }
}

export function saveDraft(draft: Draft, key = KEY) {
  try {
    localStorage.setItem(key, JSON.stringify(draft));
  } catch {
    // Quota or privacy mode: the editor keeps working, it just won't survive a reload.
  }
}
