import { describe, it, expect, vi, beforeEach } from "vitest";
import { MongoshNotFoundError } from "@/lib/mongosh";

// Mock the balancer lib so the route test focuses on input handling + status mapping.
const getBalancerState = vi.fn();
const stopBalancer = vi.fn();
const startBalancer = vi.fn();
vi.mock("@/lib/balancer", () => ({
  getBalancerState: (...a: unknown[]) => getBalancerState(...a),
  stopBalancer: (...a: unknown[]) => stopBalancer(...a),
  startBalancer: (...a: unknown[]) => startBalancer(...a),
}));

async function post(body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const { POST } = await import("@/app/api/cluster-check/balancer/route");
  const req = new Request("http://localhost/api/cluster-check/balancer", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  const res = await POST(req, undefined as never);
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

beforeEach(() => {
  getBalancerState.mockReset();
  stopBalancer.mockReset();
  startBalancer.mockReset();
});

describe("POST /api/cluster-check/balancer — input handling", () => {
  it("400 when neither uri nor conn is given", async () => {
    const { status, json } = await post({ action: "state" });
    expect(status).toBe(400);
    expect(json.error).toBe("uri or conn required");
  });

  it("400 on an invalid action", async () => {
    const { status } = await post({ uri: "mongodb://h", action: "bogus" });
    expect(status).toBe(400);
  });

  it("400 on missing action", async () => {
    const { status } = await post({ uri: "mongodb://h" });
    expect(status).toBe(400);
  });

  it("400 on malformed JSON", async () => {
    const { status, json } = await post("{not json");
    expect(status).toBe(400);
    expect(json.error).toBe("Invalid JSON body");
  });

  it("builds a URI from conn for the state action", async () => {
    getBalancerState.mockResolvedValue({ sharded: true, enabled: false });
    const { status, json } = await post({
      conn: { scheme: "mongodb", hosts: ["h:27017"] },
      action: "state",
    });
    expect(status).toBe(200);
    expect(json).toEqual({ sharded: true, enabled: false });
    expect(getBalancerState).toHaveBeenCalledWith("mongodb://h:27017/");
  });
});

describe("POST /api/cluster-check/balancer — actions", () => {
  it("state → { sharded, enabled }", async () => {
    getBalancerState.mockResolvedValue({ sharded: false, enabled: null });
    const { status, json } = await post({ uri: "mongodb://h", action: "state" });
    expect(status).toBe(200);
    expect(json).toEqual({ sharded: false, enabled: null });
  });

  it("disable → { ok: true } and calls stopBalancer", async () => {
    stopBalancer.mockResolvedValue(undefined);
    const { status, json } = await post({ uri: "mongodb://h", action: "disable" });
    expect(status).toBe(200);
    expect(json).toEqual({ ok: true });
    expect(stopBalancer).toHaveBeenCalledWith("mongodb://h");
    expect(startBalancer).not.toHaveBeenCalled();
  });

  it("enable → { ok: true } and calls startBalancer", async () => {
    startBalancer.mockResolvedValue(undefined);
    const { status, json } = await post({ uri: "mongodb://h", action: "enable" });
    expect(status).toBe(200);
    expect(json).toEqual({ ok: true });
    expect(startBalancer).toHaveBeenCalledWith("mongodb://h");
  });
});

describe("POST /api/cluster-check/balancer — error mapping", () => {
  it("503 when mongosh is missing", async () => {
    getBalancerState.mockRejectedValue(new MongoshNotFoundError());
    const { status, json } = await post({ uri: "mongodb://h", action: "state" });
    expect(status).toBe(503);
    expect(String(json.error)).toMatch(/mongosh is not installed/);
  });

  it("502 on a query failure, with the password masked", async () => {
    stopBalancer.mockRejectedValue(new Error("auth failed for mongodb://user:secret@h/admin"));
    const { status, json } = await post({ uri: "mongodb://user:secret@h/admin", action: "disable" });
    expect(status).toBe(502);
    expect(String(json.error)).not.toContain("secret");
  });
});
