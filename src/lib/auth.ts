import { scryptSync, randomBytes, timingSafeEqual } from "node:crypto";
import { getSetting, setSetting } from "./db";

// Node-only credential storage (scrypt) backed by the settings table. NOT imported by
// the Edge middleware — that only needs session.ts for cookie verification.

const USER_KEY = "authUsername";
const HASH_KEY = "authPasswordHash";
const DEFAULT_USER = "admin";
const DEFAULT_PASS = "admin";

/** `salt:hash` where hash = scrypt(password, salt). */
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string | undefined): boolean {
  if (!stored) return false;
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const expected = Buffer.from(hash, "hex");
  const actual = scryptSync(password, salt, 64);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/** Seed admin/admin on first run so the app is never left without credentials. */
export function seedAuth(): void {
  if (!getSetting(HASH_KEY)) {
    setSetting(USER_KEY, DEFAULT_USER);
    setSetting(HASH_KEY, hashPassword(DEFAULT_PASS));
  }
}

export function getAuthUsername(): string {
  return getSetting(USER_KEY) || DEFAULT_USER;
}

export function checkCredentials(username: string, password: string): boolean {
  return username === getAuthUsername() && verifyPassword(password, getSetting(HASH_KEY));
}

export function setCredentials(username: string, password: string): void {
  setSetting(USER_KEY, username);
  setSetting(HASH_KEY, hashPassword(password));
}
