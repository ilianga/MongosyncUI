"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Bell } from "lucide-react"
import { usePolling } from "@/hooks/use-polling"

interface FeedEvent {
  id: string
  migrationId: string | null
  kind: string
  message: string
  createdAt: number
  readAt: number | null
}

const LABELS: Record<string, string> = {
  REACHED_CAN_COMMIT: "Ready to commit",
  COMMITTED: "Cutover committed",
  CRASH_LOOPING: "Crash looping",
  LAG_SPIKE: "Lag spike",
  LOW_OPLOG: "Low oplog window",
}

function relativeTime(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60) return "just now"
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

// Topbar notification bell. Polls /api/events for the unread count + recent events; opening
// the dropdown marks everything read. Optionally raises a browser Notification for new events
// when the user has enabled it (best-effort, behind a localStorage toggle + granted permission).
export function NotificationBell() {
  const [open, setOpen] = useState(false)
  const [unreadOverride, setUnreadOverride] = useState<number | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const seenIds = useRef<Set<string>>(new Set())
  const primed = useRef(false)

  // The poller fetcher also fans out best-effort browser notifications for newly-seen events.
  const fetcher = useCallback(async (signal: AbortSignal) => {
    const res = await fetch("/api/events?limit=50", { signal })
    if (!res.ok) throw new Error(`Failed to load events (${res.status})`)
    const data: { events: FeedEvent[]; unread: number } = await res.json()

    const browserOn = typeof window !== "undefined" && localStorage.getItem("notifyBrowser") === "true"
    const canNotify = browserOn && typeof Notification !== "undefined" && Notification.permission === "granted"
    for (const e of data.events) {
      if (seenIds.current.has(e.id)) continue
      seenIds.current.add(e.id)
      // Skip the first load (primed=false) so we don't burst the existing backlog.
      if (canNotify && primed.current) {
        try {
          new Notification(`MongosyncUI · ${LABELS[e.kind] ?? e.kind}`, { body: e.message })
        } catch {
          /* best effort */
        }
      }
    }
    primed.current = true
    return data
  }, [])

  const { data, refresh } = usePolling(fetcher, { intervalMs: 5000 })
  const events = data?.events ?? []
  const unread = unreadOverride ?? data?.unread ?? 0

  // Close on outside click.
  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onClick)
    return () => document.removeEventListener("mousedown", onClick)
  }, [open])

  const toggleOpen = async () => {
    const next = !open
    setOpen(next)
    if (!next) {
      // On close, drop the optimistic override so fresh poll data drives the badge again.
      setUnreadOverride(null)
      return
    }
    if (unread > 0) {
      try {
        await fetch("/api/events/read", { method: "POST" })
        setUnreadOverride(0) // optimistic; cleared on next close
        await refresh()
      } catch {
        /* ignore */
      }
    }
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={toggleOpen}
        aria-label="Notifications"
        className="relative flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <Bell className="size-4" />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-4 text-destructive-foreground">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-10 z-50 w-80 overflow-hidden rounded-md border border-border bg-background shadow-lg">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <span className="text-sm font-medium">Notifications</span>
            <span className="text-xs text-muted-foreground">{events.length} recent</span>
          </div>
          <div className="max-h-96 overflow-y-auto">
            {events.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">No notifications yet.</p>
            ) : (
              events.map((e) => (
                <div key={e.id} className="border-b border-border/50 px-3 py-2 last:border-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-xs font-medium">{LABELS[e.kind] ?? e.kind}</span>
                    <span className="shrink-0 text-[10px] text-muted-foreground">{relativeTime(e.createdAt)}</span>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">{e.message}</p>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
