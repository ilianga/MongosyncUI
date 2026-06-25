import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import path from "path";
import fs from "fs";
import os from "os";

import {
  detectEvents,
  buildWebhookPayload,
  dispatchWebhook,
  composeMessage,
  EVENT_KINDS,
  type NotifiableSnapshot,
} from "@/lib/notifications";

// ── Pure transition detection (no DB) ───────────────────────────────────────────

const snap = (over: Partial<NotifiableSnapshot> = {}): NotifiableSnapshot => ({
  state: "RUNNING",
  canCommit: false,
  supervisionStatus: "running",
  ...over,
});

describe("detectEvents", () => {
  it("fires REACHED_CAN_COMMIT when canCommit flips false → true", () => {
    expect(detectEvents(snap({ canCommit: false }), snap({ canCommit: true }))).toEqual([
      EVENT_KINDS.REACHED_CAN_COMMIT,
    ]);
  });

  it("does NOT refire REACHED_CAN_COMMIT while canCommit stays true", () => {
    expect(detectEvents(snap({ canCommit: true }), snap({ canCommit: true }))).toEqual([]);
  });

  it("fires REACHED_CAN_COMMIT on first observation if already true (prev null)", () => {
    expect(detectEvents(null, snap({ canCommit: true }))).toEqual([EVENT_KINDS.REACHED_CAN_COMMIT]);
  });

  it("fires COMMITTED only on the transition into COMMITTED", () => {
    expect(detectEvents(snap({ state: "COMMITTING" }), snap({ state: "COMMITTED" }))).toEqual([
      EVENT_KINDS.COMMITTED,
    ]);
    expect(detectEvents(snap({ state: "COMMITTED" }), snap({ state: "COMMITTED" }))).toEqual([]);
  });

  it("fires CRASH_LOOPING only when supervisionStatus becomes crash_looping", () => {
    expect(
      detectEvents(snap({ supervisionStatus: "running" }), snap({ supervisionStatus: "crash_looping" }))
    ).toEqual([EVENT_KINDS.CRASH_LOOPING]);
    expect(
      detectEvents(snap({ supervisionStatus: "crash_looping" }), snap({ supervisionStatus: "crash_looping" }))
    ).toEqual([]);
  });

  it("can fire multiple events on one tick", () => {
    const fired = detectEvents(
      snap({ state: "RUNNING", canCommit: false }),
      snap({ state: "COMMITTED", canCommit: true })
    );
    expect(fired).toContain(EVENT_KINDS.REACHED_CAN_COMMIT);
    expect(fired).toContain(EVENT_KINDS.COMMITTED);
  });

  it("returns nothing when nothing notable changed", () => {
    expect(detectEvents(snap(), snap())).toEqual([]);
  });
});

describe("composeMessage / buildWebhookPayload", () => {
  it("composes a default message from kind + name", () => {
    const msg = composeMessage({ kind: EVENT_KINDS.COMMITTED, migrationId: "m1", migrationName: "Prod" });
    expect(msg).toContain("Prod");
    expect(msg.toLowerCase()).toContain("commit");
  });

  it("honors an explicit message", () => {
    expect(
      composeMessage({ kind: EVENT_KINDS.COMMITTED, migrationId: "m1", migrationName: "Prod", message: "custom" })
    ).toBe("custom");
  });

  it("builds a Slack/Discord-compatible payload with text + structured fields", () => {
    const p = buildWebhookPayload({
      kind: EVENT_KINDS.REACHED_CAN_COMMIT,
      migrationId: "m1",
      migrationName: "Prod",
    });
    expect(typeof p.text).toBe("string");
    expect(p.text).toContain("MongosyncUI");
    expect(p.kind).toBe(EVENT_KINDS.REACHED_CAN_COMMIT);
    expect(p.migrationId).toBe("m1");
    expect(p.migrationName).toBe("Prod");
    expect(typeof p.timestamp).toBe("number");
  });
});

// ── dispatchWebhook resilience (mocked fetch) ────────────────────────────────────

describe("dispatchWebhook", () => {
  afterEach(() => vi.unstubAllGlobals());

  const event = {
    kind: EVENT_KINDS.COMMITTED,
    migrationId: "m1",
    migrationName: "Prod",
  } as const;

  it("POSTs JSON with the expected body and returns ok on 2xx", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await dispatchWebhook("https://example.com/hook", event);
    expect(res.ok).toBe(true);
    expect(res.status).toBe(200);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://example.com/hook");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    const body = JSON.parse(init.body as string);
    expect(body.kind).toBe(EVENT_KINDS.COMMITTED);
    expect(body.text).toContain("Prod");
  });

  it("returns ok:false (does not throw) on a non-2xx response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 500 })));
    const res = await dispatchWebhook("https://example.com/hook", event);
    expect(res.ok).toBe(false);
    expect(res.status).toBe(500);
  });

  it("returns ok:false (does not throw) when fetch rejects", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNREFUSED"); }));
    const res = await dispatchWebhook("https://example.com/hook", event);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("ECONNREFUSED");
  });

  it("returns ok:false for an empty URL without calling fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const res = await dispatchWebhook("", event);
    expect(res.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("aborts on timeout and returns ok:false instead of throwing", async () => {
    // fetch that respects the abort signal and rejects when aborted.
    vi.stubGlobal("fetch", (_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      })
    );
    const res = await dispatchWebhook("https://example.com/hook", event, 5);
    expect(res.ok).toBe(false);
  });
});

// ── notify + DB feed round-trip ──────────────────────────────────────────────────

describe("notify (feed + webhook) and events DB", () => {
  let testDir: string;
  let originalEnv: string | undefined;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), "mongosync-ui-notif-"));
    originalEnv = process.env.MONGOSYNC_UI_DIR;
    process.env.MONGOSYNC_UI_DIR = testDir;
    vi.resetModules();
  });
  afterEach(() => {
    process.env.MONGOSYNC_UI_DIR = originalEnv;
    fs.rmSync(testDir, { recursive: true, force: true });
    vi.unstubAllGlobals();
  });

  it("recordEvent persists and getEvents/unread round-trips", async () => {
    const notif = await import("@/lib/notifications");
    const db = await import("@/lib/db");

    const row = notif.recordEvent({
      kind: notif.EVENT_KINDS.COMMITTED,
      migrationId: "m1",
      migrationName: "Prod",
    });
    expect(row).not.toBeNull();

    const events = db.getEvents(10);
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe(notif.EVENT_KINDS.COMMITTED);
    expect(events[0].migrationId).toBe("m1");
    expect(events[0].readAt).toBeNull();

    expect(db.getUnreadEventCount()).toBe(1);
    const marked = db.markEventsRead();
    expect(marked).toBe(1);
    expect(db.getUnreadEventCount()).toBe(0);
  });

  it("hasRecentEvent dedups by migration + kind within a window", async () => {
    const notif = await import("@/lib/notifications");
    const db = await import("@/lib/db");

    notif.recordEvent({ kind: notif.EVENT_KINDS.CRASH_LOOPING, migrationId: "m1", migrationName: "P" });
    expect(db.hasRecentEvent("m1", notif.EVENT_KINDS.CRASH_LOOPING, Date.now() - 60_000)).toBe(true);
    expect(db.hasRecentEvent("m2", notif.EVENT_KINDS.CRASH_LOOPING, Date.now() - 60_000)).toBe(false);
    expect(db.hasRecentEvent("m1", notif.EVENT_KINDS.COMMITTED, Date.now() - 60_000)).toBe(false);
    // Future-only window excludes the just-written row.
    expect(db.hasRecentEvent("m1", notif.EVENT_KINDS.CRASH_LOOPING, Date.now() + 60_000)).toBe(false);
  });

  it("notify records to the feed and fires the webhook when enabled", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const notif = await import("@/lib/notifications");
    const db = await import("@/lib/db");
    db.setSetting("notifyWebhookEnabled", "true");
    db.setSetting("notifyWebhookUrl", "https://example.com/hook");

    await notif.notify({ kind: notif.EVENT_KINDS.COMMITTED, migrationId: "m1", migrationName: "Prod" });

    expect(db.getEvents(10)).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("notify does NOT fire the webhook when disabled, but still records to the feed", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const notif = await import("@/lib/notifications");
    const db = await import("@/lib/db");
    db.setSetting("notifyWebhookEnabled", "false");
    db.setSetting("notifyWebhookUrl", "https://example.com/hook");

    await notif.notify({ kind: notif.EVENT_KINDS.COMMITTED, migrationId: "m1", migrationName: "Prod" });

    expect(db.getEvents(10)).toHaveLength(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("notify skips a kind that is disabled in settings", async () => {
    const notif = await import("@/lib/notifications");
    const db = await import("@/lib/db");
    // Only COMMITTED enabled — CRASH_LOOPING should be skipped entirely.
    db.setSetting("notifyEvents", notif.EVENT_KINDS.COMMITTED);

    await notif.notify({ kind: notif.EVENT_KINDS.CRASH_LOOPING, migrationId: "m1", migrationName: "P" });
    expect(db.getEvents(10)).toHaveLength(0);

    await notif.notify({ kind: notif.EVENT_KINDS.COMMITTED, migrationId: "m1", migrationName: "P" });
    expect(db.getEvents(10)).toHaveLength(1);
  });
});
