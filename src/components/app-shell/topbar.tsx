import { RunningIndicator } from "./running-indicator"

interface TopbarProps {
  title: string
  subtitle?: string
  action?: React.ReactNode
}

// Page-level sticky header. Rendered inside `<main>` (which has px-6/py-6), so it
// stretches edge-to-edge with negative margins and re-applies its own padding.
export function Topbar({ title, subtitle, action }: TopbarProps) {
  return (
    <div className="sticky top-0 z-10 -mx-6 -mt-6 mb-2 flex h-14 items-center gap-4 border-b border-border bg-background/80 px-6 backdrop-blur-md">
      <div className="min-w-0">
        <h1 className="truncate text-lg font-semibold leading-tight">{title}</h1>
        {subtitle && <p className="truncate text-xs text-muted-foreground">{subtitle}</p>}
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-3">
        {action}
        <RunningIndicator />
      </div>
    </div>
  )
}
