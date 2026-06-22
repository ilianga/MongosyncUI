import { RunningIndicator } from "./running-indicator"

interface TopbarProps {
  title: string
  action?: React.ReactNode
}

export function Topbar({ title, action }: TopbarProps) {
  return (
    <div className="sticky top-0 z-10 flex h-14 items-center border-b border-border bg-background/80 px-6 backdrop-blur">
      <h1 className="text-lg font-semibold">{title}</h1>
      <div className="ml-auto flex items-center gap-4">
        {action}
        <RunningIndicator />
      </div>
    </div>
  )
}
