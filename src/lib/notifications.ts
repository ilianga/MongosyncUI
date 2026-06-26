import { getSetting, insertEvent, type EventRow } from "./db";

// Re-exported below: `recordStateChange` writes audit rows straight to the feed (no webhook).

/**
 * Notification subsystem. All notification-specific types live here (NOT in types.ts) per
 * project convention. Two delivery paths:
 *  - an outbound webhook (Slack / Discord / generic JSON POST) fired server-side, and
 *  - an in-app event feed persisted to the `events` table and surfaced in the topbar bell.
 *
 * Everything here is best-effort: a notification failure must NEVER propagate into the poll
 * loop, so the public helpers swallow their own errors.
 */

/** Stable identifiers for the kinds of events we raise. */
export const EVENT_KINDS = {
  /** A migration first reported `canCommit: true` — it's ready for cutover. */
  REACHED_CAN_COMMIT: "REACHED_CAN_COMMIT",
  /** A migration transitioned into the COMMITTED state — cutover complete. */
  COMMITTED: "COMMITTED",
  /** A migration's supervision status became `crash_looping` — it needs attention. */
  CRASH_LOOPING: "CRASH_LOOPING",
  /** Lag rose above the configured threshold (edge-triggered). */
  LAG_SPIKE: "LAG_SPIKE",
  /** Optional: the source oplog window is running low. Reserved for future use. */
  LOW_OPLOG: "LOW_OPLOG",
  /**
   * A migration changed mongosync state (e.g. RUNNING → COMMITTING). Audit-only: recorded
   * straight to the in-app feed for the Timeline, NOT routed through the webhook (kept out of
   * ALL_EVENT_KINDS so it never carries a webhook toggle and notify() skips it).
   */
  STATE_CHANGE: "STATE_CHANGE",
} as const;

export type EventKind = (typeof EVENT_KINDS)[keyof typeof EVENT_KINDS];

/**
 * Webhook-eligible event kinds, in a stable order — used by the settings UI checkboxes and as
 * the default-enabled set. STATE_CHANGE is intentionally excluded (audit-only, see above).
 */
export const ALL_EVENT_KINDS: EventKind[] = [
  EVENT_KINDS.REACHED_CAN_COMMIT,
  EVENT_KINDS.COMMITTED,
  EVENT_KINDS.CRASH_LOOPING,
  EVENT_KINDS.LAG_SPIKE,
  EVENT_KINDS.LOW_OPLOG,
];

/** Human-readable label for each kind (used in payloads + UI). */
export const EVENT_LABELS: Record<EventKind, string> = {
  REACHED_CAN_COMMIT: "Ready to commit",
  COMMITTED: "Cutover committed",
  CRASH_LOOPING: "Crash looping",
  LAG_SPIKE: "Lag spike",
  LOW_OPLOG: "Low oplog window",
  STATE_CHANGE: "State change",
};

/** A notification event before it has been persisted (no id / timestamps yet). */
export interface NotificationEvent {
  kind: EventKind;
  migrationId: string;
  /** Display name of the migration, used to compose the message. */
  migrationName: string;
  /** Optional human-readable message. If omitted, one is composed from kind + name. */
  message?: string;
}

/** Compose a default human-readable message for an event. */
export function composeMessage(event: NotificationEvent): string {
  if (event.message) return event.message;
  const name = event.migrationName || event.migrationId;
  switch (event.kind) {
    case EVENT_KINDS.REACHED_CAN_COMMIT:
      return `"${name}" is ready to commit (canCommit is true).`;
    case EVENT_KINDS.COMMITTED:
      return `"${name}" has committed — cutover complete.`;
    case EVENT_KINDS.CRASH_LOOPING:
      return `"${name}" is crash looping and needs attention.`;
    case EVENT_KINDS.LAG_SPIKE:
      return `"${name}" lag spiked.`;
    case EVENT_KINDS.LOW_OPLOG:
      return `"${name}" source oplog window is running low.`;
    default:
      return `"${name}": ${event.kind}`;
  }
}

// ── Transition detection (pure) ────────────────────────────────────────────────

/** Minimal snapshot of a migration's notifiable signals at one point in time. */
export interface NotifiableSnapshot {
  state: string;
  /** True if mongosync currently reports canCommit. */
  canCommit: boolean;
  /** Current supervision status (e.g. "running", "crash_looping"). */
  supervisionStatus: string;
  /** Current change-event-application lag in seconds, when known. */
  lagTimeSeconds?: number | null;
}

/** Options for the pure transition detector. */
export interface DetectOpts {
  /** Lag threshold (seconds) for LAG_SPIKE; <= 0 disables the check. */
  lagThresholdSec?: number;
}

/**
 * Pure transition detector. Given the previous and current snapshot of a migration, return
 * the event kinds that should fire on this tick. Edge-triggered: only fires when a signal
 * FLIPS from off→on (so it won't refire every tick while the condition stays true). The
 * poller layers a persisted dedup on top (so it also won't refire across restarts within an
 * occurrence). `prev` is null on the first observation of a migration.
 */
export function detectEvents(
  prev: NotifiableSnapshot | null,
  cur: NotifiableSnapshot,
  opts: DetectOpts = {}
): EventKind[] {
  const fired: EventKind[] = [];

  // canCommit flips false→true (or first-ever observation already true).
  if (cur.canCommit && !(prev?.canCommit ?? false)) {
    fired.push(EVENT_KINDS.REACHED_CAN_COMMIT);
  }

  // state transitions into COMMITTED.
  if (cur.state === "COMMITTED" && prev?.state !== "COMMITTED") {
    fired.push(EVENT_KINDS.COMMITTED);
  }

  // supervision status becomes crash_looping.
  if (cur.supervisionStatus === "crash_looping" && prev?.supervisionStatus !== "crash_looping") {
    fired.push(EVENT_KINDS.CRASH_LOOPING);
  }

  // lag crosses the configured threshold (below-or-unknown → above). Disabled when the
  // threshold is <= 0 so a fresh install never alerts on the large lag of an initial copy.
  const thr = opts.lagThresholdSec ?? 0;
  if (thr > 0 && cur.lagTimeSeconds != null && cur.lagTimeSeconds > thr) {
    const prevAbove = (prev?.lagTimeSeconds ?? 0) > thr;
    if (!prevAbove) fired.push(EVENT_KINDS.LAG_SPIKE);
  }

  return fired;
}

/**
 * Record a mongosync state transition to the in-app feed (audit-only, no webhook). Drives the
 * migration Timeline. Best-effort: never throws.
 */
export function recordStateChange(migrationId: string, from: string, to: string): void {
  try {
    insertEvent({ migrationId, kind: EVENT_KINDS.STATE_CHANGE, message: `${from} → ${to}` });
  } catch {
    /* best-effort — timeline audit must never break the poll loop */
  }
}

// ── Settings helpers ──────────────────────────────────────────────────────────

/** Whether the outbound webhook is enabled in settings. */
export function isWebhookEnabled(): boolean {
  return getSetting("notifyWebhookEnabled") === "true";
}

/** The configured webhook URL, or empty string. */
export function webhookUrl(): string {
  return getSetting("notifyWebhookUrl") ?? "";
}

/**
 * Which event kinds the user has enabled. Stored as a comma-separated list under
 * `notifyEvents`. An unset/empty setting means "all kinds enabled" (sensible default so a
 * fresh install still notifies for the core lifecycle events).
 */
export function enabledEventKinds(): Set<EventKind> {
  const raw = getSetting("notifyEvents");
  if (raw === undefined || raw.trim() === "") return new Set(ALL_EVENT_KINDS);
  const parts = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is EventKind => (ALL_EVENT_KINDS as string[]).includes(s));
  return new Set(parts);
}

/** Is this event kind enabled for notification? */
export function isEventKindEnabled(kind: EventKind): boolean {
  return enabledEventKinds().has(kind);
}

/**
 * Lag threshold (seconds) for the LAG_SPIKE alert, from settings. 0 (the default) disables
 * the alert — a deliberately conservative default so the large lag of an initial copy never
 * fires it. The user opts in by setting a positive value in Settings.
 */
export function lagThresholdSec(): number {
  const raw = getSetting("notifyLagThresholdSec");
  const n = raw === undefined ? 0 : Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// ── Webhook delivery ──────────────────────────────────────────────────────────

/** The JSON payload POSTed to the webhook. `text` is Slack/Discord-compatible. */
export interface WebhookPayload {
  text: string;
  kind: EventKind;
  label: string;
  migrationId: string;
  migrationName: string;
  message: string;
  timestamp: number;
}

/** Build the webhook payload for an event. */
export function buildWebhookPayload(event: NotificationEvent): WebhookPayload {
  const message = composeMessage(event);
  const label = EVENT_LABELS[event.kind] ?? event.kind;
  return {
    text: `MongosyncUI · ${label}: ${message}`,
    kind: event.kind,
    label,
    migrationId: event.migrationId,
    migrationName: event.migrationName,
    message,
    timestamp: Date.now(),
  };
}

/**
 * POST the event to a webhook URL. Resilient: bounded by a timeout, and never throws — any
 * failure (network, non-2xx, bad URL, timeout) is caught and returned as `{ ok: false }`.
 * Safe to call from inside the poller. Used directly by the "Send test" endpoint too.
 */
export async function dispatchWebhook(
  url: string,
  event: NotificationEvent,
  timeoutMs = 8000
): Promise<{ ok: boolean; status?: number; error?: string }> {
  if (!url || url.trim() === "") return { ok: false, error: "No webhook URL configured" };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildWebhookPayload(event)),
      signal: controller.signal,
    });
    if (!res.ok) return { ok: false, status: res.status, error: `HTTP ${res.status}` };
    return { ok: true, status: res.status };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    return { ok: false, error };
  } finally {
    clearTimeout(timer);
  }
}

// ── Persistence + combined notify ─────────────────────────────────────────────

/**
 * Persist an event to the in-app feed. Returns the stored row, or null if persistence
 * failed (never throws).
 */
export function recordEvent(event: NotificationEvent): EventRow | null {
  try {
    return insertEvent({
      migrationId: event.migrationId,
      kind: event.kind,
      message: composeMessage(event),
    });
  } catch {
    return null;
  }
}

/**
 * Full notification path: persist to the in-app feed AND, if the webhook is enabled and a
 * URL is configured, fire the outbound webhook. Both steps are best-effort and isolated, so
 * a failure in either can never break the caller (the poller).
 */
export async function notify(event: NotificationEvent): Promise<void> {
  // Respect the per-kind enable toggle for both delivery paths.
  if (!isEventKindEnabled(event.kind)) return;

  // 1) Always record to the in-app feed.
  try {
    recordEvent(event);
  } catch {
    /* swallowed — feed persistence is best-effort */
  }

  // 2) Optionally fire the webhook.
  try {
    if (isWebhookEnabled()) {
      const url = webhookUrl();
      if (url.trim() !== "") await dispatchWebhook(url, event);
    }
  } catch {
    /* swallowed — webhook delivery is best-effort */
  }
}
