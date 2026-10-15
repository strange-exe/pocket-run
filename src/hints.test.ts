import { describe, expect, it } from "vitest";
import { cHint } from "./hints";

const wrap = (body: string) => `#include <stdio.h>\nint main(){ char opt, s[50]; int n; ${body} return 0; }`;

describe("hints for C and C++ programs", () => {
  it.each([
    ['scanf("%c",&opt);', /" %c"/],
    ['scanf ( "%c" , &opt );', /" %c"/],
    ['if (scanf("%c%c", &opt, &opt) == 2) {}', /" %c"/],
    ["gets(s);", /fgets/],
    ["getch();", /Turbo C/],
    ["clrscr();", /Turbo C/],
  ])("explains %s", (body, hint) => {
    expect(cHint(wrap(body), "ok")).toMatch(hint);
  });

  it("explains conio.h and void main", () => {
    expect(cHint("#include <conio.h>\nint main(){ return 0; }", "compile-error")).toMatch(/Turbo C/);
    expect(cHint('#include <stdio.h>\nvoid main(){ printf("hi"); }', "error")).toMatch(/int main/);
  });

  it.each([
    'scanf(" %c",&opt);',
    'scanf("%d %c",&n,&opt);',
    'printf("%c", opt);',
    "fgets(s, sizeof s, stdin);",
    "getchar();",
  ])("stays quiet for %s", (body) => {
    expect(cHint(wrap(body), "ok")).toBeNull();
  });

  it('keeps the scanf("%c") tip for programs that compiled', () => {
    expect(cHint(wrap('scanf("%c",&opt);'), "compile-error")).toBeNull();
  });
});
