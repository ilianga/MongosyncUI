import { describe, it, expect, vi } from "vitest";
import type { StartConfig } from "@/lib/types";

// Mock node:child_process so computeSourceTotalBytes is testable without a live cluster.
// Per convention: set mockImplementation INLINE per test, reading the trailing callback.
const execFileImpl = vi.fn();
vi.mock("node:child_process", () => ({
  execFile: (...args: unknown[]) => execFileImpl(...args),
}));

type Cb = (e: Error | null, out?: { stdout: string; stderr: string }) => void;
function cbOf(args: unknown[]): Cb {
  return args[args.length - 1] as Cb;
}

async function load() {
  return await import("@/lib/source-stats");
}

describe("computeSourceTotalBytes", () => {
  it("returns the total when mongosh reports a positive number", async () => {
    execFileImpl.mockImplementation((...args: unknown[]) => cbOf(args)(null, { stdout: '{"total":123456}\n', stderr: "" }));
    const { computeSourceTotalBytes } = await load();
    expect(await computeSourceTotalBytes("mongodb://h", {})).toBe(123456);
  });

  it("returns null when the total is 0", async () => {
    execFileImpl.mockImplementation((...args: unknown[]) => cbOf(args)(null, { stdout: '{"total":0}', stderr: "" }));
    const { computeSourceTotalBytes } = await load();
    expect(await computeSourceTotalBytes("mongodb://h", {})).toBeNull();
  });

  it("returns null when mongosh is missing (ENOENT) — caller falls back to mongosync estimate", async () => {
    execFileImpl.mockImplementation((...args: unknown[]) => cbOf(args)(Object.assign(new Error("ENOENT"), { code: "ENOENT" })));
    const { computeSourceTotalBytes } = await load();
    expect(await computeSourceTotalBytes("mongodb://h", {})).toBeNull();
  });

  it("returns null on unparseable output", async () => {
    execFileImpl.mockImplementation((...args: unknown[]) => cbOf(args)(null, { stdout: "boom", stderr: "" }));
    const { computeSourceTotalBytes } = await load();
    expect(await computeSourceTotalBytes("mongodb://h", {})).toBeNull();
  });

  it("embeds the namespace filter into the eval script", async () => {
    execFileImpl.mockImplementation((...args: unknown[]) => cbOf(args)(null, { stdout: '{"total":1}', stderr: "" }));
    const { computeSourceTotalBytes } = await load();
    const cfg: StartConfig = { includeNamespaces: [{ database: "shop" }] };
    execFileImpl.mockClear();
    await computeSourceTotalBytes("mongodb://h", cfg);
    const evalArg = (execFileImpl.mock.calls[0][1] as string[]).at(-1) as string;
    expect(evalArg).toContain('"include"');
    expect(evalArg).toContain("shop");
  });
});
