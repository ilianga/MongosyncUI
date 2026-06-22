"use client"

import { useEffect, useState } from "react"

const ACTIVE_STATES = new Set(["RUNNING", "COMMITTING", "REVERSING"])

export function RunningIndicator() {
  const [count, setCount] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false

    async function fetchMigrations() {
      try {
        const res = await fetch("/api/migrations")
        if (!res.ok) return
        const data = await res.json()
        if (!cancelled) {
          const migrations: Array<{ state: string }> = Array.isArray(data) ? data : []
          setCount(migrations.filter((m) => ACTIVE_STATES.has(m.state)).length)
        }
      } catch {
        // silently ignore fetch errors
      }
    }

    fetchMigrations()
    const interval = setInterval(fetchMigrations, 5000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [])

  if (count === null) {
    return (
      <span className="flex items-center gap-1.5 font-mono text-sm text-muted-foreground">
        <span className="inline-block size-2 rounded-full bg-muted-foreground/40" />
        <span>—</span>
      </span>
    )
  }

  if (count === 0) {
    return (
      <span className="flex items-center gap-1.5 font-mono text-sm text-muted-foreground">
        <span className="inline-block size-2 rounded-full bg-muted-foreground/60" />
        <span>idle</span>
      </span>
    )
  }

  return (
    <span className="flex items-center gap-1.5 font-mono text-sm text-[#00ED64]">
      <span className="animate-pulse-dot inline-block size-2 rounded-full bg-[#00ED64]" />
      <span>{count} running</span>
    </span>
  )
}
