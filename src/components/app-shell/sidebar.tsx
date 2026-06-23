"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useEffect, useState } from "react"
import { ThemeToggle } from "./theme-toggle"
import { cn } from "@/lib/utils"

// Nav items
const NAV_ITEMS = [
  {
    href: "/",
    label: "Migrations",
    exact: true,
    icon: (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="size-4 shrink-0"
        aria-hidden
      >
        <rect width="7" height="7" x="3" y="3" rx="1" />
        <rect width="7" height="7" x="14" y="3" rx="1" />
        <rect width="7" height="7" x="14" y="14" rx="1" />
        <rect width="7" height="7" x="3" y="14" rx="1" />
      </svg>
    ),
  },
  {
    href: "/migrations/new",
    label: "New Migration",
    exact: false,
    icon: (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="size-4 shrink-0"
        aria-hidden
      >
        <circle cx="12" cy="12" r="10" />
        <path d="M12 8v8M8 12h8" />
      </svg>
    ),
  },
  {
    href: "/settings",
    label: "Settings",
    exact: false,
    icon: (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="size-4 shrink-0"
        aria-hidden
      >
        <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    ),
  },
]

type VersionStatus =
  | { status: "loading" }
  | { status: "ok"; version: string }
  | { status: "error" }

export function Sidebar() {
  const pathname = usePathname()
  const [versionStatus, setVersionStatus] = useState<VersionStatus>({ status: "loading" })

  useEffect(() => {
    fetch("/api/mongosync/version")
      .then((res) => {
        if (!res.ok) throw new Error("not ok")
        return res.json()
      })
      .then((data) => {
        const raw: string = data?.version ?? data?.output ?? ""
        const firstLine = raw.split("\n")[0].trim()
        setVersionStatus({ status: "ok", version: firstLine || "detected" })
      })
      .catch(() => {
        setVersionStatus({ status: "error" })
      })
  }, [])

  function isActive(href: string, exact: boolean) {
    if (exact) return pathname === href
    return pathname.startsWith(href)
  }

  return (
    <aside
      className={cn(
        "flex h-full min-h-screen w-16 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:w-60",
        "fixed left-0 top-0 z-20"
      )}
    >
      {/* Logo / wordmark */}
      <div className="flex h-14 items-center gap-2.5 px-3 md:px-4">
        {/* MongoDB leaf glyph */}
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          className="size-6 shrink-0 text-[#00ED64]"
          fill="currentColor"
          aria-hidden
        >
          <path d="M12 2C10.5 2 9 3.5 8 5.5 7 7.5 6.5 10 6.5 12c0 2.8 1.2 5.2 3 6.8L12 22l2.5-3.2c1.8-1.6 3-4 3-6.8 0-2-.5-4.5-1.5-6.5C15 3.5 13.5 2 12 2z" />
        </svg>
        <span className="hidden font-semibold text-sidebar-accent-foreground md:inline">
          MongosyncUI
        </span>
      </div>

      {/* Nav */}
      <nav className="flex flex-1 flex-col gap-1 px-2 py-2">
        {NAV_ITEMS.map((item) => {
          const active = isActive(item.href, item.exact)
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "relative flex items-center gap-2.5 rounded-md px-2 py-2 text-sm transition-colors",
                active
                  ? "bg-sidebar-accent text-sidebar-accent-foreground before:absolute before:inset-y-1 before:left-0 before:w-0.5 before:rounded-full before:bg-primary"
                  : "text-sidebar-foreground hover:bg-sidebar-accent/60"
              )}
            >
              {item.icon}
              <span className="hidden md:inline">{item.label}</span>
            </Link>
          )
        })}
      </nav>

      {/* Footer: binary chip + theme toggle */}
      <div className="mt-auto flex flex-col gap-2 border-t border-sidebar-border px-2 py-3">
        {/* Version chip */}
        <div className="flex items-center gap-2 px-1">
          {versionStatus.status === "loading" && (
            <span className="inline-block size-2 rounded-full bg-muted-foreground/40" />
          )}
          {versionStatus.status === "ok" && (
            <>
              <span className="inline-block size-2 shrink-0 rounded-full bg-[#00ED64]" />
              <span className="hidden truncate font-mono text-xs text-sidebar-foreground md:inline">
                {versionStatus.version}
              </span>
            </>
          )}
          {versionStatus.status === "error" && (
            <>
              <span className="inline-block size-2 shrink-0 rounded-full bg-destructive" />
              <span className="hidden font-mono text-xs text-destructive md:inline">
                binary not found
              </span>
            </>
          )}
        </div>

        {/* Theme toggle + logout */}
        <div className="flex items-center justify-center gap-1 md:justify-start md:px-1">
          <ThemeToggle />
          <button
            type="button"
            onClick={async () => {
              await fetch("/api/auth/logout", { method: "POST" });
              window.location.assign("/login");
            }}
            title="Sign out"
            aria-label="Sign out"
            className="flex items-center gap-2.5 rounded-md px-2 py-2 text-sm text-sidebar-foreground transition-colors hover:bg-sidebar-accent/60"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-4 shrink-0" aria-hidden>
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" x2="9" y1="12" y2="12" />
            </svg>
            <span className="hidden md:inline">Sign out</span>
          </button>
        </div>
      </div>
    </aside>
  )
}
