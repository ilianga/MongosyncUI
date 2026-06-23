import { describe, it, expect, vi } from "vitest";

// Mock node:child_process so the mongosh runner is testable without a real binary.
// Per project convention: set mockImplementation INLINE per test and read the trailing
// callback as the LAST arg (NOT a shared beforeEach(mockReset) helper).
const execFileImpl = vi.fn();
vi.mock("node:child_process", () => ({
  execFile: (...args: unknown[]) => execFileImpl(...args),
}));

type Cb = (e: (Error & { code?: string }) | null, out?: { stdout: string; stderr: string }) => void;

function cbOf(args: unknown[]): Cb {
  return args[args.length - 1] as Cb;
}

async function load() {
  return await import("@/lib/mongosh");
}

describe("runMongoshEval", () => {
  it("returns trimmed stdout", async () => {
    execFileImpl.mockImplementation((...args: unknown[]) => cbOf(args)(null, { stdout: "  hello\n", stderr: "" }));
    const { runMongoshEval } = await load();
    expect(await runMongoshEval("mongodb://h", "print('hello')")).toBe("hello");
  });

  it("throws MongoshNotFoundError on ENOENT", async () => {
    execFileImpl.mockImplementation((...args: unknown[]) => {
      const err = Object.assign(new Error("spawn mongosh ENOENT"), { code: "ENOENT" });
      cbOf(args)(err);
    });
    const { runMongoshEval, MongoshNotFoundError, isMongoshNotFound } = await load();
    const p = runMongoshEval("mongodb://h", "x");
    await expect(p).rejects.toBeInstanceOf(MongoshNotFoundError);
    await p.catch((e) => expect(isMongoshNotFound(e)).toBe(true));
  });

  it("throws MongoshNotFoundError on EACCES (present but not executable)", async () => {
    execFileImpl.mockImplementation((...args: unknown[]) => {
      cbOf(args)(Object.assign(new Error("permission denied"), { code: "EACCES" }));
    });
    const { runMongoshEval, MongoshNotFoundError } = await load();
    await expect(runMongoshEval("mongodb://h", "x")).rejects.toBeInstanceOf(MongoshNotFoundError);
  });

  it("maps a killed/timeout error to a clear timeout message", async () => {
    execFileImpl.mockImplementation((...args: unknown[]) => {
      cbOf(args)(Object.assign(new Error("timeout"), { killed: true, signal: "SIGTERM" }) as Error & { code?: string });
    });
    const { runMongoshEval } = await load();
    await expect(runMongoshEval("mongodb://h", "x", { timeoutMs: 1234 })).rejects.toThrow(/timed out after 1234ms/);
  });

  it("preserves the original message for generic eval failures (auth detection downstream)", async () => {
    execFileImpl.mockImplementation((...args: unknown[]) => cbOf(args)(new Error("not authorized on admin")));
    const { runMongoshEval } = await load();
    await expect(runMongoshEval("mongodb://h", "x")).rejects.toThrow(/not authorized on admin/);
  });
});

describe("runMongoshJson", () => {
  it("parses JSON stdout", async () => {
    execFileImpl.mockImplementation((...args: unknown[]) => cbOf(args)(null, { stdout: '{"a":1}\n', stderr: "" }));
    const { runMongoshJson } = await load();
    expect(await runMongoshJson<{ a: number }>("mongodb://h", "x")).toEqual({ a: 1 });
  });

  it("throws a clear error on non-JSON output", async () => {
    execFileImpl.mockImplementation((...args: unknown[]) => cbOf(args)(null, { stdout: "not json", stderr: "" }));
    const { runMongoshJson } = await load();
    await expect(runMongoshJson("mongodb://h", "x")).rejects.toThrow(/non-JSON/);
  });

  it("propagates MongoshNotFoundError", async () => {
    execFileImpl.mockImplementation((...args: unknown[]) => cbOf(args)(Object.assign(new Error("nope"), { code: "ENOENT" })));
    const { runMongoshJson, MongoshNotFoundError } = await load();
    await expect(runMongoshJson("mongodb://h", "x")).rejects.toBeInstanceOf(MongoshNotFoundError);
  });
});

describe("isMongoshAvailable", () => {
  it("returns true when mongosh runs", async () => {
    execFileImpl.mockImplementation((...args: unknown[]) => cbOf(args)(null, { stdout: "1\n", stderr: "" }));
    const { isMongoshAvailable } = await load();
    expect(await isMongoshAvailable()).toBe(true);
  });

  it("returns false when mongosh is missing", async () => {
    execFileImpl.mockImplementation((...args: unknown[]) => cbOf(args)(Object.assign(new Error("x"), { code: "ENOENT" })));
    const { isMongoshAvailable } = await load();
    expect(await isMongoshAvailable()).toBe(false);
  });

  it("returns true even when the eval errors for a non-spawn reason (binary present)", async () => {
    execFileImpl.mockImplementation((...args: unknown[]) => cbOf(args)(new Error("auth failed")));
    const { isMongoshAvailable } = await load();
    expect(await isMongoshAvailable()).toBe(true);
  });
});

describe("isMongoshNotFound", () => {
  it("recognises ENOENT and EACCES codes", async () => {
    const { isMongoshNotFound } = await load();
    expect(isMongoshNotFound(Object.assign(new Error(), { code: "ENOENT" }))).toBe(true);
    expect(isMongoshNotFound(Object.assign(new Error(), { code: "EACCES" }))).toBe(true);
    expect(isMongoshNotFound(new Error("auth"))).toBe(false);
    expect(isMongoshNotFound(null)).toBe(false);
  });
});
