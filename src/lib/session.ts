// Stateless signed session token, verifiable in BOTH the Node API routes and the
// Edge middleware. Uses Web Crypto (crypto.subtle) + btoa/atob, which exist in both
// runtimes — deliberately no node:crypto / better-sqlite3 imports so middleware stays
// Edge-compatible.

export const SESSION_COOKIE = "msync_session";
const DEFAULT_TTL_SEC = 60 * 60 * 24 * 7; // 7 days

function getSecret(): string {
  // Personal localhost tool: a stable fallback is acceptable, but honour an override.
  return process.env.MSYNC_AUTH_SECRET || "mongosync-ui-dev-secret-change-me";
}

function b64urlEncode(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(str: string): Uint8Array {
  const s = str.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function sign(data: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(getSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return new Uint8Array(sig);
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** Build a signed token for `username`, valid for `ttlSec` seconds. */
export async function createSession(username: string, ttlSec = DEFAULT_TTL_SEC): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const payload = b64urlEncode(new TextEncoder().encode(`${username}\n${exp}`));
  const sig = b64urlEncode(await sign(payload));
  return `${payload}.${sig}`;
}

/** Returns the username if the token is well-formed, correctly signed, and unexpired. */
export async function verifySession(token: string | undefined | null): Promise<string | null> {
  if (!token) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  try {
    const expected = await sign(payload);
    if (!constantTimeEqual(b64urlDecode(sig), expected)) return null;
    const decoded = new TextDecoder().decode(b64urlDecode(payload));
    const [username, expStr] = decoded.split("\n");
    const exp = Number(expStr);
    if (!username || !Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return null;
    return username;
  } catch {
    return null;
  }
}
