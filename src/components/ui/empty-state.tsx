import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center text-center py-16 px-4 gap-4")}>
      {icon && (
        <div className="h-12 w-12 rounded-full bg-accent text-accent-foreground grid place-items-center shrink-0">
          {icon}
        </div>
      )}
      <div className="flex flex-col items-center gap-1">
        <p className="text-lg font-semibold">{title}</p>
        {description && (
          <p className="text-sm text-muted-foreground max-w-sm">{description}</p>
        )}
      </div>
      {action && <div>{action}</div>}
    </div>
  );
}
