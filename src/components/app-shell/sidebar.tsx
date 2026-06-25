"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useEffect, useState } from "react"
import { ThemeToggle } from "./theme-toggle"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
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
    href: "/migrations/new-multi",
    label: "Multi-sync",
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
        {/* One source fanning out to multiple destinations */}
        <circle cx="5" cy="12" r="2" />
        <circle cx="19" cy="5" r="2" />
        <circle cx="19" cy="12" r="2" />
        <circle cx="19" cy="19" r="2" />
        <path d="M7 12h4M11 12l6-6M11 12h6M11 12l6 6" />
      </svg>
    ),
  },
  {
    href: "/connections",
    label: "Connections",
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
        {/* Plug / connector glyph */}
        <path d="M9 2v4M15 2v4" />
        <path d="M7 6h10v4a5 5 0 0 1-10 0V6z" />
        <path d="M12 15v3a3 3 0 0 0 3 3h2" />
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

export function Sidebar({
  collapsed = false,
  onToggle,
}: {
  collapsed?: boolean
  onToggle?: () => void
}) {
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

  // Labels are shown only when expanded. The expanded rail keeps the original
  // responsive behavior (icon-only below md, full at md+); the collapsed rail is
  // a fixed icon-only column at every breakpoint, with tooltips for discoverability.
  const showLabels = !collapsed

  return (
    <TooltipProvider delay={300}>
      <aside
        className={cn(
          "fixed left-0 top-0 z-20 flex h-full min-h-screen flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-200 ease-out",
          collapsed ? "w-16" : "w-16 md:w-60"
        )}
      >
        {/* Logo / wordmark + collapse toggle */}
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
          {showLabels && (
            <span className="hidden truncate font-semibold text-sidebar-accent-foreground md:inline">
              MongosyncUI
            </span>
          )}
          {onToggle && !collapsed && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    onClick={onToggle}
                    aria-label="Collapse sidebar"
                    aria-expanded
                    className="ml-auto hidden size-7 items-center justify-center rounded-md text-sidebar-foreground transition-colors hover:bg-sidebar-accent/60 md:inline-flex"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="size-4"
                      aria-hidden
                    >
                      <path d="m15 18-6-6 6-6" />
                    </svg>
                  </button>
                }
              />
              <TooltipContent side="right">Collapse sidebar</TooltipContent>
            </Tooltip>
          )}
        </div>

        {/* Expand affordance — only visible on the collapsed desktop rail */}
        {collapsed && onToggle && (
          <div className="hidden px-2 md:block">
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    onClick={onToggle}
                    aria-label="Expand sidebar"
                    aria-expanded={false}
                    className="flex w-full items-center justify-center rounded-md py-1.5 text-sidebar-foreground transition-colors hover:bg-sidebar-accent/60"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="size-4"
                      aria-hidden
                    >
                      <path d="m9 18 6-6-6-6" />
                    </svg>
                  </button>
                }
              />
              <TooltipContent side="right">Expand sidebar</TooltipContent>
            </Tooltip>
          </div>
        )}

        {/* Nav */}
        <nav className="flex flex-1 flex-col gap-1 px-2 py-2">
          {NAV_ITEMS.map((item) => {
            const active = isActive(item.href, item.exact)
            const link = (
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex items-center gap-2.5 rounded-md px-2 py-2 text-sm transition-colors",
                  collapsed && "md:justify-center",
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground before:absolute before:inset-y-1 before:left-0 before:w-0.5 before:rounded-full before:bg-primary"
                    : "text-sidebar-foreground hover:bg-sidebar-accent/60"
                )}
              >
                {item.icon}
                {showLabels && <span className="hidden md:inline">{item.label}</span>}
              </Link>
            )
            // On a collapsed rail there are no labels, so surface them via tooltip.
            if (collapsed) {
              return (
                <Tooltip key={item.href}>
                  <TooltipTrigger render={link} />
                  <TooltipContent side="right">{item.label}</TooltipContent>
                </Tooltip>
              )
            }
            return <div key={item.href}>{link}</div>
          })}
        </nav>

        {/* Footer: binary chip + theme toggle */}
        <div className="mt-auto flex flex-col gap-2 border-t border-sidebar-border px-2 py-3">
          {/* Version chip */}
          <div className={cn("flex items-center gap-2 px-1", collapsed && "md:justify-center")}>
            {versionStatus.status === "loading" && (
              <span className="inline-block size-2 rounded-full bg-muted-foreground/40" />
            )}
            {versionStatus.status === "ok" && (
              <>
                <span className="inline-block size-2 shrink-0 rounded-full bg-[#00ED64]" />
                {showLabels && (
                  <span className="hidden truncate font-mono text-xs text-sidebar-foreground md:inline">
                    {versionStatus.version}
                  </span>
                )}
              </>
            )}
            {versionStatus.status === "error" && (
              <>
                <span className="inline-block size-2 shrink-0 rounded-full bg-destructive" />
                {showLabels && (
                  <span className="hidden font-mono text-xs text-destructive md:inline">
                    binary not found
                  </span>
                )}
              </>
            )}
          </div>

          {/* Theme toggle + logout */}
          <div
            className={cn(
              "flex items-center gap-1",
              collapsed ? "flex-col md:items-center" : "justify-center md:justify-start md:px-1"
            )}
          >
            <ThemeToggle />
            <button
              type="button"
              onClick={async () => {
                await fetch("/api/auth/logout", { method: "POST" });
                window.location.assign("/login");
              }}
              title="Sign out"
              aria-label="Sign out"
              className={cn(
                "flex items-center gap-2.5 rounded-md px-2 py-2 text-sm text-sidebar-foreground transition-colors hover:bg-sidebar-accent/60",
                collapsed && "md:justify-center"
              )}
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-4 shrink-0" aria-hidden>
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" x2="9" y1="12" y2="12" />
              </svg>
              {showLabels && <span className="hidden md:inline">Sign out</span>}
            </button>
          </div>
        </div>
      </aside>
    </TooltipProvider>
  )
}
