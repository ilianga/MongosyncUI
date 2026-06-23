import { describe, it, expect, vi, afterEach } from "vitest";
import { z } from "zod";
import { jsonError, jsonOk, readJson, handle, maskError, ApiError } from "@/lib/api";

function jsonReq(body: string): Request {
  return new Request("http://localhost/api/test", { method: "POST", body });
}

describe("jsonError / jsonOk", () => {
  it("jsonError builds { error, ...extra } with status", async () => {
    const res = jsonError("nope", 409, { code: "CONFLICT" });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "nope", code: "CONFLICT" });
  });

  it("jsonOk defaults to 200 and echoes data", async () => {
    const res = jsonOk({ a: 1 });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ a: 1 });
  });

  it("jsonOk honors a custom status", () => {
    expect(jsonOk({ a: 1 }, 201).status).toBe(201);
  });
});

describe("readJson", () => {
  it("returns {} for an empty body", async () => {
    const req = new Request("http://localhost/api/test", { method: "POST", body: "" });
    await expect(readJson(req)).resolves.toEqual({});
  });

  it("parses valid JSON without a schema", async () => {
    await expect(readJson(jsonReq('{"x":1}'))).resolves.toEqual({ x: 1 });
  });

  it("throws ApiError(400) on malformed JSON", async () => {
    await expect(readJson(jsonReq("{not json"))).rejects.toMatchObject({
      status: 400,
      message: "Invalid JSON body",
    });
  });

  it("validates with a zod schema and returns parsed data", async () => {
    const schema = z.object({ name: z.string() });
    await expect(readJson(jsonReq('{"name":"hi"}'), schema)).resolves.toEqual({ name: "hi" });
  });

  it("throws ApiError(400) with a readable, path-prefixed message on invalid input", async () => {
    const schema = z.object({ name: z.string().min(1, "name is required") });
    await expect(readJson(jsonReq('{"name":""}'), schema)).rejects.toMatchObject({
      status: 400,
      message: "name: name is required",
    });
  });
});

describe("handle", () => {
  afterEach(() => vi.restoreAllMocks());

  it("passes through a successful response", async () => {
    const wrapped = handle(async () => jsonOk({ ok: true }));
    const res = await wrapped(jsonReq("{}"), undefined);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("turns a thrown ApiError into its status + message + extra", async () => {
    const wrapped = handle(async () => {
      throw new ApiError("missing", 404, { hint: "x" });
    });
    const res = await wrapped(jsonReq("{}"), undefined);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "missing", hint: "x" });
  });

  it("catches an unexpected error: logs server-side, returns generic 500 (no leak)", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const wrapped = handle(async () => {
      throw new Error("boom secret stack trace");
    });
    const res = await wrapped(jsonReq("{}"), undefined);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Internal error" });
    expect(spy).toHaveBeenCalled();
  });

  it("masks URIs (credentials) in the server-side log message", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const wrapped = handle(async () => {
      throw new Error("connect failed: mongodb://user:s3cret@host:27017/db");
    });
    await wrapped(jsonReq("{}"), undefined);
    const logged = spy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(logged).not.toContain("s3cret");
    expect(logged).toContain("mongodb://user:***@host");
  });

  it("converts a malformed-body ApiError from readJson into a 400", async () => {
    const wrapped = handle(async (req: Request) => {
      const body = await readJson(req);
      return jsonOk(body);
    });
    const res = await wrapped(jsonReq("{bad"), undefined);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid JSON body" });
  });
});

describe("maskError", () => {
  it("masks a URI password in an Error message", () => {
    const masked = maskError(new Error("mongodb://u:p4ss@h:1/x failed"));
    expect(masked).toContain("mongodb://u:***@h");
    expect(masked).not.toContain("p4ss");
  });

  it("handles non-Error values", () => {
    expect(maskError("plain string")).toBe("plain string");
    expect(maskError(123)).toBe("123");
  });
});
