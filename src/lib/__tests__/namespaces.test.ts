import { describe, it, expect, vi } from "vitest";
import {
  parseNamespaceListing,
  isHiddenDatabase,
  isHiddenCollection,
} from "@/lib/namespaces";

const execFileImpl = vi.fn();
vi.mock("node:child_process", () => ({
  execFile: (...args: unknown[]) => execFileImpl(...args),
}));

function mockMongosh(result: { stdout?: string; error?: Error }) {
  execFileImpl.mockImplementation((...args: unknown[]) => {
    const cb = args[args.length - 1] as (
      e: Error | null,
      out?: { stdout: string; stderr: string }
    ) => void;
    if (typeof cb !== "function") return;
    if (result.error) cb(result.error);
    else cb(null, { stdout: result.stdout ?? "", stderr: "" });
  });
}

describe("isHiddenDatabase", () => {
  it("hides system databases", () => {
    expect(isHiddenDatabase("admin")).toBe(true);
    expect(isHiddenDatabase("local")).toBe(true);
    expect(isHiddenDatabase("config")).toBe(true);
  });
  it("hides mongosync internal databases", () => {
    expect(isHiddenDatabase("__mdb_internal_mongosync")).toBe(true);
  });
  it("keeps user databases", () => {
    expect(isHiddenDatabase("sales")).toBe(false);
  });
});

describe("isHiddenCollection", () => {
  it("hides system.* and internal collections", () => {
    expect(isHiddenCollection("system.views")).toBe(true);
    expect(isHiddenCollection("__mdb_internal_x")).toBe(true);
  });
  it("keeps normal collections", () => {
    expect(isHiddenCollection("orders")).toBe(false);
  });
});

describe("parseNamespaceListing", () => {
  it("drops system dbs/collections, normalises type, and sorts", () => {
    const raw = {
      databases: [
        { name: "sales", collections: [{ name: "orders" }, { name: "accounts", type: "view" }, { name: "system.views" }] },
        { name: "admin", collections: [{ name: "users" }] },
        { name: "marketing", collections: [{ name: "campaigns", type: "collection" }] },
      ],
    };
    expect(parseNamespaceListing(raw)).toEqual({
      databases: [
        {
          name: "marketing",
          collections: [{ name: "campaigns", type: "collection" }],
        },
        {
          name: "sales",
          // sorted; system.views removed; missing type defaulted to "collection"
          collections: [
            { name: "accounts", type: "view" },
            { name: "orders", type: "collection" },
          ],
        },
      ],
    });
  });

  it("tolerates missing/empty fields", () => {
    expect(parseNamespaceListing({ databases: [] })).toEqual({ databases: [] });
    expect(
      parseNamespaceListing({ databases: [{ name: "db", collections: [] }] })
    ).toEqual({ databases: [{ name: "db", collections: [] }] });
  });
});

describe("listNamespaces (via mongosh)", () => {
  it("parses mongosh JSON and filters", async () => {
    mockMongosh({
      stdout: JSON.stringify({
        databases: [
          { name: "config", collections: [] },
          { name: "shop", collections: [{ name: "items", type: "collection" }] },
        ],
      }),
    });
    const { listNamespaces } = await import("@/lib/namespaces");
    expect(await listNamespaces("mongodb://h/")).toEqual({
      databases: [{ name: "shop", collections: [{ name: "items", type: "collection" }] }],
    });
  });

  it("propagates a non-JSON failure as an error", async () => {
    mockMongosh({ stdout: "not json" });
    const { listNamespaces } = await import("@/lib/namespaces");
    await expect(listNamespaces("mongodb://h/")).rejects.toThrow();
  });

  it("propagates a MongoshNotFound (ENOENT) error", async () => {
    mockMongosh({ error: Object.assign(new Error("spawn mongosh ENOENT"), { code: "ENOENT" }) });
    const { listNamespaces } = await import("@/lib/namespaces");
    const { isMongoshNotFound } = await import("@/lib/mongosh");
    await expect(listNamespaces("mongodb://h/").catch((e) => {
      throw new Error(isMongoshNotFound(e) ? "NOT_FOUND" : "other");
    })).rejects.toThrow("NOT_FOUND");
  });
});
