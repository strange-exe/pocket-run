import type { Page } from "@playwright/test";
import { expect, openApp, openFile, run, test } from "./helpers";

// Programs the way students actually write and run them: pasted over the sample, menu-driven, with habits from
// other compilers. Reported 2026-10-15: a pasted menu program "couldn't run".

/** The program the student reported, unchanged (including its classic scanf("%c") mistake). */
const MENU_PROGRAM = `#include <stdio.h>
#include <stdlib.h>

typedef struct node{
    struct node *left;
	int val;
	struct node *right;
} tree;

void insert(tree **ptr, int x){
    if(!(*ptr)){
        *ptr=malloc(sizeof(tree));
        (*ptr)->val=x;
        (*ptr)->left=(*ptr)->right=NULL;
    }
    else if((*ptr)->val > x) insert(&((*ptr)->left),x);
    else insert(&((*ptr)->right),x);
    return;
}

int main(){
	tree *root=NULL;
    int num;
    char opt='Y';
    do{
        printf("Enter num : ");
        scanf("%d",&num);
        insert(&root,num);
        if(!root) printf("Memory full\\n");
        else{
            printf("Node added to binary tree\\n");
            printf("Continue ? Y/N : ");
            scanf("%c",&opt);
        }
    }while(root && opt!='N');
	return 0;
}
`;

async function installCpp(page: Page) {
  await openFile(page, "x.c", "int main(void) { return 0; }\n");
  await page.locator("#pack-button").click();
  await expect(page.locator("#status-dot")).toHaveAttribute("data-state", "ready", { timeout: 60_000 });
}

/** Replaces everything in the editor, as a paste over the sample does. */
async function pasteOverEditor(page: Page, code: string) {
  await page.locator(".cm-content").click();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.insertText(code);
}

test.describe("a program pasted over the sample", () => {
  test("doesn't inherit the sample's input, so a menu program asks and finishes", async ({ page }) => {
    test.setTimeout(120_000);
    await openApp(page);
    await installCpp(page);
    // Back to a first visit's state (the sample and its "Abhinesh" answer); the C/C++ pack stays installed.
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await expect(page.locator("#status-dot")).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
    await expect(page.locator("#stdin")).toHaveValue("Abhinesh\n");

    await page.locator("#filename").fill("main.c");
    await pasteOverEditor(page, MENU_PROGRAM);
    await expect(page.locator("#stdin")).toHaveValue(""); // the sample's answer went with the sample
    await expect(page.locator("#status-dot")).toHaveAttribute("data-state", "ready", { timeout: 60_000 });

    await page.locator("#run-btn").click();
    const field = page.locator("#live-input-field");
    for (const answer of ["5", "3"]) {
      await expect(field).toBeVisible({ timeout: 15_000 });
      await field.fill(answer);
      await field.press("Enter");
    }
    // The program's own scanf("%c") reads the Enter, so it asks for a number again: answering N there ends it,
    // exactly as in a terminal.
    await expect(field).toBeVisible({ timeout: 15_000 });
    await field.fill("N");
    await field.press("Enter");
    await expect(page.locator("#run-label")).toHaveText("Run", { timeout: 20_000 });
    await expect(page.locator("#receipt")).toHaveAttribute("data-status", "ok");
    await expect(page.locator("#output")).toContainText("Enter num : 5\nNode added to binary tree");
    await expect(page.locator("#notice")).toContainText('scanf(" %c"');
  });

  test("keeps input the student typed themselves", async ({ page }) => {
    await openApp(page);
    await page.locator("#stdin").fill("42\n");
    await pasteOverEditor(page, "n = int(input())\nprint(n * 2)\n");
    await expect(page.locator("#stdin")).toHaveValue("42\n");
  });
});

test.describe("hints for habits from other compilers", () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page);
    await installCpp(page);
  });

  for (const [name, code, error, hint] of [
    ["Turbo C's conio.h", "#include <stdio.h>\n#include <conio.h>\nint main(){ clrscr(); getch(); return 0; }\n", "conio.h", "Turbo C"],
    ["gets()", "#include <stdio.h>\nint main(){ char s[50]; gets(s); return 0; }\n", "gets", "fgets"],
  ] as const) {
    test(`${name}: the error comes with a plain explanation`, async ({ page }) => {
      const r = await run(page, "main.c", code);
      expect(r.status).toBe("compile-error");
      expect(r.output).toContain(error);
      await expect(page.locator("#notice")).toContainText(hint);
    });
  }
});

test.describe("joined symbols (ligatures) in code", () => {
  const ligatures = (page: Page) =>
    page.locator(".cm-content").evaluate((el) => getComputedStyle(el.querySelector(".cm-line")!).fontVariantLigatures);

  test("are off by default, can be turned on, and the choice is kept", async ({ page }) => {
    await openApp(page);
    await pasteOverEditor(page, "if p != q and a == b: pass\n");
    expect(await ligatures(page)).toBe("none");
    await page.locator("#theme-btn").click();
    const box = page.getByRole("checkbox", { name: /Joined symbols in code/ });
    await expect(box).not.toBeChecked();
    await box.check();
    expect(await ligatures(page)).toBe("normal");
    await page.reload();
    await expect(page.locator("#status-dot")).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
    expect(await ligatures(page)).toBe("normal");
    // The about page follows the same choice (its start-up script reads it).
    await page.goto("/about/");
    expect(await page.locator(".code").first().evaluate((el) => getComputedStyle(el).fontVariantLigatures)).toBe("normal");
  });
});
