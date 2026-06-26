"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { useTheme } from "next-themes"

import { cn } from "@/lib/utils"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"

// Shared inline-SVG icon style, matching the sidebar's glyphs.
const ICON_CLASS = "size-4 shrink-0"

const MigrationsIcon = (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={ICON_CLASS}
    aria-hidden
  >
    <rect width="7" height="7" x="3" y="3" rx="1" />
    <rect width="7" height="7" x="14" y="3" rx="1" />
    <rect width="7" height="7" x="14" y="14" rx="1" />
    <rect width="7" height="7" x="3" y="14" rx="1" />
  </svg>
)

const NewMigrationIcon = (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={ICON_CLASS}
    aria-hidden
  >
    <circle cx="12" cy="12" r="10" />
    <path d="M12 8v8M8 12h8" />
  </svg>
)

const MultiSyncIcon = (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={ICON_CLASS}
    aria-hidden
  >
    <circle cx="5" cy="12" r="2" />
    <circle cx="19" cy="5" r="2" />
    <circle cx="19" cy="12" r="2" />
    <circle cx="19" cy="19" r="2" />
    <path d="M7 12h4M11 12l6-6M11 12h6M11 12l6 6" />
  </svg>
)

const ConnectionsIcon = (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={ICON_CLASS}
    aria-hidden
  >
    <path d="M9 2v4M15 2v4" />
    <path d="M7 6h10v4a5 5 0 0 1-10 0V6z" />
    <path d="M12 15v3a3 3 0 0 0 3 3h2" />
  </svg>
)

const SettingsIcon = (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={ICON_CLASS}
    aria-hidden
  >
    <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
)

const ThemeIcon = (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={ICON_CLASS}
    aria-hidden
  >
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
  </svg>
)

type CommandItem = {
  id: string
  title: string
  icon: React.ReactNode
  // Short hint shown on the right (e.g. "Migration").
  group?: string
  run: () => void
}

type MigrationSummary = {
  id: string
  name: string
}

function isMigrationSummary(value: unknown): value is MigrationSummary {
  if (typeof value !== "object" || value === null) return false
  const record = value as Record<string, unknown>
  return typeof record.id === "string" && typeof record.name === "string"
}

export default function CommandPalette() {
  const router = useRouter()
  const { theme, setTheme } = useTheme()

  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState("")
  const [highlight, setHighlight] = React.useState(0)
  const [migrations, setMigrations] = React.useState<MigrationSummary[]>([])

  const inputRef = React.useRef<HTMLInputElement>(null)
  const listRef = React.useRef<HTMLDivElement>(null)

  // Global Cmd+K / Ctrl+K toggle. Escape is handled by the Dialog itself.
  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const isToggle =
        (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k"
      if (!isToggle) return
      event.preventDefault()
      setOpen((prev) => !prev)
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])

  // Reset state and (re)load migrations each time the palette opens.
  React.useEffect(() => {
    if (!open) return
    // Defer the reset past the effect body so we don't trigger a synchronous
    // cascading render (react-hooks/set-state-in-effect).
    queueMicrotask(() => {
      setQuery("")
      setHighlight(0)
    })

    const controller = new AbortController()
    fetch("/api/migrations", { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error("failed to load migrations")
        return res.json()
      })
      .then((data: unknown) => {
        const list = Array.isArray(data) ? data : []
        setMigrations(list.filter(isMigrationSummary))
      })
      .catch(() => {
        // Fetch failure is silent — dynamic entries are simply omitted.
      })

    return () => controller.abort()
  }, [open])

  const close = React.useCallback(() => setOpen(false), [])

  const commands = React.useMemo<CommandItem[]>(() => {
    const navItems: CommandItem[] = [
      {
        id: "nav-migrations",
        title: "Migrations",
        icon: MigrationsIcon,
        group: "Go to",
        run: () => router.push("/"),
      },
      {
        id: "nav-new-migration",
        title: "New Migration",
        icon: NewMigrationIcon,
        group: "Go to",
        run: () => router.push("/migrations/new"),
      },
      {
        id: "nav-multi-sync",
        title: "Multi-sync",
        icon: MultiSyncIcon,
        group: "Go to",
        run: () => router.push("/migrations/new-multi"),
      },
      {
        id: "nav-connections",
        title: "Connections",
        icon: ConnectionsIcon,
        group: "Go to",
        run: () => router.push("/connections"),
      },
      {
        id: "nav-settings",
        title: "Settings",
        icon: SettingsIcon,
        group: "Go to",
        run: () => router.push("/settings"),
      },
      {
        id: "toggle-theme",
        title: "Toggle theme",
        icon: ThemeIcon,
        group: "Action",
        run: () => setTheme(theme === "dark" ? "light" : "dark"),
      },
    ]

    const migrationItems: CommandItem[] = migrations.map((migration) => ({
      id: `migration-${migration.id}`,
      title: `Go to migration: ${migration.name}`,
      icon: MigrationsIcon,
      group: "Migration",
      run: () => router.push(`/migrations/${migration.id}`),
    }))

    return [...navItems, ...migrationItems]
  }, [migrations, router, setTheme, theme])

  const filtered = React.useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return commands
    return commands.filter((command) =>
      command.title.toLowerCase().includes(needle)
    )
  }, [commands, query])

  // Derive the effective highlight, clamped to the current filtered list, so we
  // never need a bounds-correcting effect when filtering shrinks the list.
  const activeIndex =
    filtered.length === 0 ? -1 : Math.min(highlight, filtered.length - 1)

  const runCommand = React.useCallback(
    (command: CommandItem | undefined) => {
      if (!command) return
      close()
      command.run()
    },
    [close]
  )

  function onInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault()
      setHighlight((prev) =>
        filtered.length === 0 ? 0 : (prev + 1) % filtered.length
      )
    } else if (event.key === "ArrowUp") {
      event.preventDefault()
      setHighlight((prev) =>
        filtered.length === 0 ? 0 : (prev - 1 + filtered.length) % filtered.length
      )
    } else if (event.key === "Enter") {
      event.preventDefault()
      if (activeIndex >= 0) runCommand(filtered[activeIndex])
    }
  }

  // Keep the highlighted row scrolled into view.
  React.useEffect(() => {
    if (!open) return
    const container = listRef.current
    if (!container) return
    const node = container.querySelector<HTMLElement>(
      `[data-index="${activeIndex}"]`
    )
    node?.scrollIntoView({ block: "nearest" })
  }, [activeIndex, open])

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        showCloseButton={false}
        className="top-[20%] max-w-lg translate-y-0 gap-0 p-0 sm:max-w-lg"
      >
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <div className="border-b border-border p-2">
          <label htmlFor="command-palette-input" className="sr-only">
            Search commands
          </label>
          <Input
            id="command-palette-input"
            ref={inputRef}
            autoFocus
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setHighlight(0)
            }}
            onKeyDown={onInputKeyDown}
            placeholder="Type a command or search…"
            role="combobox"
            aria-expanded
            aria-controls="command-palette-list"
            aria-autocomplete="list"
            className="h-10 border-0 bg-transparent text-sm focus-visible:ring-0"
          />
        </div>

        <div
          ref={listRef}
          id="command-palette-list"
          role="listbox"
          aria-label="Commands"
          className="max-h-80 overflow-y-auto p-1.5"
        >
          {filtered.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              No commands found.
            </p>
          ) : (
            filtered.map((command, index) => {
              const active = index === activeIndex
              return (
                <button
                  key={command.id}
                  type="button"
                  data-index={index}
                  role="option"
                  aria-selected={active}
                  onMouseMove={() => setHighlight(index)}
                  onClick={() => runCommand(command)}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm text-popover-foreground transition-colors",
                    active
                      ? "bg-accent text-accent-foreground"
                      : "hover:bg-accent/60"
                  )}
                >
                  <span className="text-muted-foreground">{command.icon}</span>
                  <span className="flex-1 truncate">{command.title}</span>
                  {command.group && (
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {command.group}
                    </span>
                  )}
                </button>
              )
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
