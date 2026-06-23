import type { Migration } from "./types";

/**
 * Structured connection configuration — the form INPUT. On create we derive a standard
 * MongoDB connection string from this (see buildConnectionString) and persist THAT as
 * sourceUri/destUri so config-generator and the mongosh helpers keep working unchanged.
 * The structured object itself is persisted (JSON) as sourceConn/destConn for display/edit.
 */
export interface ConnectionConfig {
  /** Legacy / advanced passthrough: when set, used verbatim and everything else is ignored. */
  raw?: string;
  scheme?: "mongodb" | "mongodb+srv";
  hosts?: string[];
  authMethod?: "none" | "password" | "x509" | "kerberos" | "ldap" | "aws" | "oidc";
  username?: string;
  password?: string;
  authSource?: string;
  authMechanism?: "DEFAULT" | "SCRAM-SHA-1" | "SCRAM-SHA-256";
  authMechanismProperties?: Record<string, string>;
  tls?: {
    enabled?: boolean;
    caFile?: string;
    certKeyFile?: string;
    certKeyPassword?: string;
    allowInvalidCertificates?: boolean;
    allowInvalidHostnames?: boolean;
  };
}

/** RFC 3986 userinfo percent-encoding. encodeURIComponent misses a few chars MongoDB cares about. */
function encodeUserinfo(s: string): string {
  return encodeURIComponent(s).replace(
    /[!'()*]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase()
  );
}

/**
 * Build a standard MongoDB connection string from a ConnectionConfig.
 * Returns conn.raw verbatim when present (legacy passthrough).
 */
export function buildConnectionString(conn: ConnectionConfig): string {
  if (conn.raw && conn.raw.trim()) return conn.raw;

  const scheme = conn.scheme ?? "mongodb";
  const hosts = (conn.hosts ?? []).map((h) => h.trim()).filter(Boolean);
  const hostPart = hosts.join(",");

  const method = conn.authMethod ?? "none";
  const opts: string[] = [];

  const withCredentials = () =>
    conn.username
      ? encodeUserinfo(conn.username) +
        (conn.password ? ":" + encodeUserinfo(conn.password) : "") +
        "@"
      : "";
  const usernameOnly = () => (conn.username ? encodeUserinfo(conn.username) + "@" : "");

  let userinfo = "";
  switch (method) {
    case "password": {
      userinfo = withCredentials();
      if (conn.authMechanism && conn.authMechanism !== "DEFAULT") {
        opts.push(`authMechanism=${conn.authMechanism}`);
      }
      if (conn.authSource) opts.push(`authSource=${encodeURIComponent(conn.authSource)}`);
      break;
    }
    case "x509": {
      userinfo = usernameOnly();
      opts.push("authMechanism=MONGODB-X509");
      opts.push("authSource=$external");
      break;
    }
    case "ldap": {
      userinfo = withCredentials();
      opts.push("authMechanism=PLAIN");
      opts.push("authSource=$external");
      break;
    }
    case "kerberos": {
      userinfo = usernameOnly();
      opts.push("authMechanism=GSSAPI");
      opts.push("authSource=$external");
      break;
    }
    case "aws": {
      userinfo = withCredentials();
      opts.push("authMechanism=MONGODB-AWS");
      opts.push("authSource=$external");
      break;
    }
    case "oidc": {
      userinfo = usernameOnly();
      opts.push("authMechanism=MONGODB-OIDC");
      break;
    }
    case "none":
    default:
      break;
  }

  if (conn.authMechanismProperties && Object.keys(conn.authMechanismProperties).length > 0) {
    const joined = Object.entries(conn.authMechanismProperties)
      .map(([k, v]) => `${k}:${v}`)
      .join(",");
    opts.push(`authMechanismProperties=${joined}`);
  }

  const tls = conn.tls;
  if (tls?.enabled) {
    opts.push("tls=true");
    if (tls.caFile) opts.push(`tlsCAFile=${encodeURIComponent(tls.caFile)}`);
    if (tls.certKeyFile) opts.push(`tlsCertificateKeyFile=${encodeURIComponent(tls.certKeyFile)}`);
    if (tls.certKeyPassword)
      opts.push(`tlsCertificateKeyFilePassword=${encodeURIComponent(tls.certKeyPassword)}`);
    if (tls.allowInvalidCertificates) opts.push("tlsAllowInvalidCertificates=true");
    if (tls.allowInvalidHostnames) opts.push("tlsAllowInvalidHostnames=true");
  }

  const query = opts.length ? `?${opts.join("&")}` : "";
  return `${scheme}://${userinfo}${hostPart}/${query}`;
}

/**
 * Resolve the structured ConnectionConfig for one side of a migration. Falls back to a
 * raw passthrough of the persisted sourceUri/destUri when no structured JSON is stored
 * (legacy rows or string-only creates).
 */
export function getConnection(migration: Migration, side: "source" | "dest"): ConnectionConfig {
  const json = side === "source" ? migration.sourceConn : migration.destConn;
  if (json) {
    try {
      return JSON.parse(json) as ConnectionConfig;
    } catch {
      /* fall through to raw */
    }
  }
  return { raw: side === "source" ? migration.sourceUri : migration.destUri };
}
