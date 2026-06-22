import { describe, it, expect } from "vitest";

async function load() {
  return await import("@/lib/cluster-check");
}

describe("parseMongoUri", () => {
  it("extracts a single host:port", async () => {
    const { parseMongoUri } = await load();
    expect(parseMongoUri("mongodb://user:pass@host1:27017/db").hosts).toEqual(["host1:27017"]);
  });

  it("extracts multiple hosts from a replica set URI", async () => {
    const { parseMongoUri } = await load();
    expect(parseMongoUri("mongodb://h1:27017,h2:27018,h3:27019/?replicaSet=rs0").hosts).toEqual([
      "h1:27017",
      "h2:27018",
      "h3:27019",
    ]);
  });

  it("defaults port 27017 when omitted", async () => {
    const { parseMongoUri } = await load();
    expect(parseMongoUri("mongodb://localhost/test").hosts).toEqual(["localhost:27017"]);
  });

  it("handles mongodb+srv by returning the srv host", async () => {
    const { parseMongoUri } = await load();
    expect(parseMongoUri("mongodb+srv://user:pass@cluster.mongodb.net/db").hosts).toEqual([
      "cluster.mongodb.net:27017",
    ]);
  });
});
