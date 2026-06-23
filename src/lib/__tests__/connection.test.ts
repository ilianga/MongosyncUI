import { describe, it, expect } from "vitest";
import { buildConnectionString, getConnection, type ConnectionConfig } from "@/lib/connection";
import type { Migration } from "@/lib/types";

describe("buildConnectionString", () => {
  it("returns raw verbatim (legacy passthrough)", () => {
    const raw = "mongodb://user:pass@h1:27017,h2:27017/?replicaSet=rs0&tls=true";
    expect(buildConnectionString({ raw })).toBe(raw);
  });

  it("ignores structured fields when raw is set", () => {
    const raw = "mongodb+srv://example.net/";
    expect(
      buildConnectionString({ raw, scheme: "mongodb", hosts: ["x:1"], authMethod: "password" })
    ).toBe(raw);
  });

  it("builds a no-auth string", () => {
    expect(
      buildConnectionString({ scheme: "mongodb", hosts: ["localhost:27017"], authMethod: "none" })
    ).toBe("mongodb://localhost:27017/");
  });

  it("joins multiple hosts", () => {
    expect(
      buildConnectionString({ scheme: "mongodb", hosts: ["a:27017", "b:27017", "c:27017"] })
    ).toBe("mongodb://a:27017,b:27017,c:27017/");
  });

  it("supports mongodb+srv scheme", () => {
    expect(buildConnectionString({ scheme: "mongodb+srv", hosts: ["cluster.example.net"] })).toBe(
      "mongodb+srv://cluster.example.net/"
    );
  });

  it("password + SCRAM-SHA-256 + authSource", () => {
    expect(
      buildConnectionString({
        scheme: "mongodb",
        hosts: ["h:27017"],
        authMethod: "password",
        username: "alice",
        password: "secret",
        authMechanism: "SCRAM-SHA-256",
        authSource: "admin",
      })
    ).toBe("mongodb://alice:secret@h:27017/?authMechanism=SCRAM-SHA-256&authSource=admin");
  });

  it("omits authMechanism when DEFAULT", () => {
    expect(
      buildConnectionString({
        scheme: "mongodb",
        hosts: ["h:27017"],
        authMethod: "password",
        username: "alice",
        password: "secret",
        authMechanism: "DEFAULT",
        authSource: "admin",
      })
    ).toBe("mongodb://alice:secret@h:27017/?authSource=admin");
  });

  it("x509 with cert file", () => {
    expect(
      buildConnectionString({
        scheme: "mongodb",
        hosts: ["h:27017"],
        authMethod: "x509",
        tls: { enabled: true, certKeyFile: "/data/certs/m1/certKey.pem" },
      })
    ).toBe(
      "mongodb://h:27017/?authMechanism=MONGODB-X509&authSource=$external&tls=true&tlsCertificateKeyFile=%2Fdata%2Fcerts%2Fm1%2FcertKey.pem"
    );
  });

  it("x509 with optional username", () => {
    expect(
      buildConnectionString({
        scheme: "mongodb",
        hosts: ["h:27017"],
        authMethod: "x509",
        username: "CN=client,OU=eng",
      })
    ).toBe(
      "mongodb://CN%3Dclient%2COU%3Deng@h:27017/?authMechanism=MONGODB-X509&authSource=$external"
    );
  });

  it("ldap (PLAIN over $external)", () => {
    expect(
      buildConnectionString({
        scheme: "mongodb",
        hosts: ["h:27017"],
        authMethod: "ldap",
        username: "ldapuser",
        password: "ldappass",
      })
    ).toBe("mongodb://ldapuser:ldappass@h:27017/?authMechanism=PLAIN&authSource=$external");
  });

  it("kerberos with SERVICE_NAME via authMechanismProperties", () => {
    expect(
      buildConnectionString({
        scheme: "mongodb",
        hosts: ["h:27017"],
        authMethod: "kerberos",
        username: "user@REALM.COM",
        authMechanismProperties: { SERVICE_NAME: "mongodb" },
      })
    ).toBe(
      "mongodb://user%40REALM.COM@h:27017/?authMechanism=GSSAPI&authSource=$external&authMechanismProperties=SERVICE_NAME:mongodb"
    );
  });

  it("aws with session token", () => {
    expect(
      buildConnectionString({
        scheme: "mongodb",
        hosts: ["h:27017"],
        authMethod: "aws",
        username: "AKIAEXAMPLE",
        password: "secretkey",
        authMechanismProperties: { AWS_SESSION_TOKEN: "tok123" },
      })
    ).toBe(
      "mongodb://AKIAEXAMPLE:secretkey@h:27017/?authMechanism=MONGODB-AWS&authSource=$external&authMechanismProperties=AWS_SESSION_TOKEN:tok123"
    );
  });

  it("oidc emits MONGODB-OIDC mechanism", () => {
    expect(
      buildConnectionString({ scheme: "mongodb", hosts: ["h:27017"], authMethod: "oidc" })
    ).toBe("mongodb://h:27017/?authMechanism=MONGODB-OIDC");
  });

  it("tls with CA + allowInvalidCertificates", () => {
    expect(
      buildConnectionString({
        scheme: "mongodb",
        hosts: ["h:27017"],
        authMethod: "none",
        tls: {
          enabled: true,
          caFile: "/data/certs/m1/ca.pem",
          allowInvalidCertificates: true,
        },
      })
    ).toBe(
      "mongodb://h:27017/?tls=true&tlsCAFile=%2Fdata%2Fcerts%2Fm1%2Fca.pem&tlsAllowInvalidCertificates=true"
    );
  });

  it("tls emits cert key password and allowInvalidHostnames", () => {
    const s = buildConnectionString({
      scheme: "mongodb",
      hosts: ["h:27017"],
      tls: {
        enabled: true,
        certKeyFile: "/c/k.pem",
        certKeyPassword: "p@ss",
        allowInvalidHostnames: true,
      },
    });
    expect(s).toContain("tlsCertificateKeyFile=%2Fc%2Fk.pem");
    expect(s).toContain("tlsCertificateKeyFilePassword=p%40ss");
    expect(s).toContain("tlsAllowInvalidHostnames=true");
  });

  it("percent-encodes username and password with special characters", () => {
    expect(
      buildConnectionString({
        scheme: "mongodb",
        hosts: ["h:27017"],
        authMethod: "password",
        username: "p@ss:w/rd",
        password: "p@ss:w/rd",
      })
    ).toBe("mongodb://p%40ss%3Aw%2Frd:p%40ss%3Aw%2Frd@h:27017/");
  });
});

describe("getConnection", () => {
  const base = { sourceUri: "mongodb://src", destUri: "mongodb://dst" } as Migration;

  it("parses structured JSON when present", () => {
    const conn: ConnectionConfig = { scheme: "mongodb", hosts: ["h:1"], authMethod: "none" };
    const m = { ...base, sourceConn: JSON.stringify(conn) } as Migration;
    expect(getConnection(m, "source")).toEqual(conn);
  });

  it("falls back to raw passthrough of the persisted URI", () => {
    expect(getConnection(base, "source")).toEqual({ raw: "mongodb://src" });
    expect(getConnection(base, "dest")).toEqual({ raw: "mongodb://dst" });
  });

  it("falls back to raw when JSON is malformed", () => {
    const m = { ...base, destConn: "not json{" } as Migration;
    expect(getConnection(m, "dest")).toEqual({ raw: "mongodb://dst" });
  });
});
