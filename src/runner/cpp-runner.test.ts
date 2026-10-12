import { describe, expect, it } from "vitest";
import type { FromCompiler } from "./clang-protocol";
import { CppRunner } from "./cpp-runner";

/** A stand-in for the compiler worker: records what it's sent and replies when the test says so. */
class FakeWorker {
  sent: { type: string }[] = [];
  private listeners: Record<string, ((e: { data: FromCompiler }) => void)[]> = {};
  addEventListener(type: string, fn: (e: { data: FromCompiler }) => void) { (this.listeners[type] ??= []).push(fn); }
  removeEventListener(type: string, fn: (e: { data: FromCompiler }) => void) {
    this.listeners[type] = (this.listeners[type] ?? []).filter((f) => f !== fn);
  }
  postMessage(msg: { type: string }) { this.sent.push(msg); }
  terminate() {}
  reply(data: FromCompiler) { for (const fn of this.listeners.message ?? []) fn({ data }); }
}

function runnerWithAbsentPack() {
  const compiler = new FakeWorker();
  const runner = new CppRunner(() => compiler as unknown as Worker, () => new FakeWorker() as unknown as Worker);
  compiler.reply({ type: "pack", installed: false });
  return { runner, compiler };
}

describe("the C/C++ download", () => {
  it("starts when asked, once the pack is known to be missing", () => {
    const { runner, compiler } = runnerWithAbsentPack();
    expect(runner.state).toBe("absent");
    runner.download();
    expect(runner.state).toBe("downloading");
    expect(compiler.sent.map((m) => m.type)).toEqual(["check", "download"]);
  });

  it("never fails silently: a blank reason still gives the student one (and so a Try again button)", () => {
    // WebKit stalled a test with the Download button back and no message (2026-10-12): a failure that
    // arrives without a reason must still be reported, or the press looks like it did nothing.
    const { runner, compiler } = runnerWithAbsentPack();
    runner.download();
    compiler.reply({ type: "download-failed", error: "" });
    expect(runner.state).toBe("absent");
    expect(runner.error).not.toBe("");
  });

  it("keeps the worker's own reason when there is one", () => {
    const { runner, compiler } = runnerWithAbsentPack();
    runner.download();
    compiler.reply({ type: "download-failed", error: "clang.wasm: HTTP 503" });
    expect(runner.error).toBe("clang.wasm: HTTP 503");
  });
});
