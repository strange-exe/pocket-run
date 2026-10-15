// Gentle hints for classic beginner mistakes, shown after a run as information. They explain messages that are
// accurate but unhelpful to a student (a linker error for gets, "conio.h not found"), or behaviour that is the
// same in any terminal (scanf("%c") skipping a prompt). They never block or change anything.
import type { RunStatus } from "./runner/runner";

const HINTS: { applies: (code: string, status: RunStatus) => boolean; text: string }[] = [
  {
    // Turbo C habits: conio.h isn't part of standard C, so it doesn't exist here (or in GCC or Clang).
    applies: (code) => /#\s*include\s*<conio\.h>/.test(code) || /\b(?:getch|getche|clrscr)\s*\(/.test(code),
    text: "Tip: conio.h (getch, clrscr) comes from Turbo C and isn't standard C, so it isn't available here. " +
      "Remove it: drop clrscr(), and use getchar() instead of getch().",
  },
  {
    // gets() was removed from C in C11 (it can't be used safely); the linker reports "undefined symbol: gets".
    applies: (code) => /\bgets\s*\(/.test(code),
    text: "Tip: gets() was removed from C because it can overflow its array. " +
      'Use fgets(s, sizeof s, stdin) for a whole line, or scanf("%49s", s) for one word.',
  },
  {
    // void main(): C++ refuses it; C runs it but the exit code is garbage, so a working program looks failed.
    applies: (code) => /\bvoid\s+main\s*\(/.test(code),
    text: "Tip: main must return int: write int main() and end it with return 0; " +
      "(with void main the program's exit code is random, so it may look like it failed).",
  },
  {
    // scanf("%c") right after reading a number also reads the Enter typed after it, so a "Y/N" prompt seems
    // skipped. A space before %c skips that Enter. Only worth saying once the program compiled and ran.
    applies: (code, status) => status !== "compile-error" && /\bscanf\s*\(\s*"%c/.test(code),
    text: 'Tip: scanf("%c") also reads the Enter left from the previous answer, so it may not wait for you. ' +
      'Write scanf(" %c", ...) with a space before %c to skip it.',
  },
];

/** The first hint that fits a C or C++ program after a run, or null. */
export function cHint(code: string, status: RunStatus): string | null {
  return HINTS.find((h) => h.applies(code, status))?.text ?? null;
}
