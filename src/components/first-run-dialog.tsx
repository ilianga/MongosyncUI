"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Copy } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "mongosyncui:onboarded";
const OPEN_EVENT = "mongosyncui:open-onboarding";

type Step = {
  n: number;
  title: string;
  subtext: string;
  href: string;
};

const STEPS: Step[] = [
  {
    n: 1,
    title: "Point to your mongosync binary",
    subtext: "Set or auto-detect the mongosync path.",
    href: "/settings",
  },
  {
    n: 2,
    title: "Add your clusters",
    subtext: "Save reusable source/destination connections.",
    href: "/connections",
  },
  {
    n: 3,
    title: "Create your first migration",
    subtext: "Configure and start a sync.",
    href: "/migrations/new",
  },
];

const EXAMPLE_CONNECTIONS: { label: string; value: string }[] = [
  {
    label: "Source (local)",
    value: "mongodb://localhost:27017/?directConnection=true",
  },
  {
    label: "Destination (local replica set)",
    value: "mongodb://localhost:27018/?replicaSet=rs1&directConnection=true",
  },
];

export default function FirstRunDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  // Direct the dialog's initial focus to the primary action so a step row isn't auto-focused
  // (which gave step 1 a heavy green focus ring that read as "selected").
  const getStartedRef = useRef<HTMLButtonElement>(null);

  // Open automatically on first run; (re)open on the custom event. localStorage is a
  // client-only external system, so this read has to happen after mount (a lazy initializer
  // would cause an SSR hydration mismatch). The mount-time setOpen is intentional.
  useEffect(() => {
    let onboarded = false;
    try {
      onboarded = localStorage.getItem(STORAGE_KEY) === "1";
    } catch {
      // localStorage unavailable (private mode) — treat as not onboarded, show once.
    }
    if (!onboarded) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- first-run external read
      setOpen(true);
    }

    const onOpen = () => setOpen(true);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, []);

  const persist = useCallback(() => {
    try {
      localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      // ignore — best effort
    }
  }, []);

  // Closing by any means persists the flag so it won't reopen next load.
  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next) persist();
      setOpen(next);
    },
    [persist]
  );

  const go = useCallback(
    (href: string) => {
      persist();
      setOpen(false);
      router.push(href);
    },
    [persist, router]
  );

  const copy = useCallback(async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success("Copied");
    } catch {
      toast.error("Couldn't copy to clipboard");
    }
  }, []);

  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md" initialFocus={getStartedRef}>
        <DialogHeader>
          <DialogTitle className="font-serif text-xl">Welcome to MongosyncUI</DialogTitle>
          <DialogDescription>
            Manage MongoDB cluster-to-cluster migrations with mongosync — here&apos;s how to
            get going.
          </DialogDescription>
        </DialogHeader>

        {/* Atlas-style get-started checklist: a single divided list, not heavy cards. */}
        <ol className="divide-y divide-border overflow-hidden rounded-lg border border-border">
          {STEPS.map((step) => (
            <li key={step.n}>
              <button
                type="button"
                onClick={() => go(step.href)}
                className={cn(
                  "group flex w-full items-center gap-3 bg-card p-3 text-left transition-colors",
                  "hover:bg-accent focus-visible:relative focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40"
                )}
              >
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                  {step.n}
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-sm font-medium text-foreground">{step.title}</span>
                  <span className="text-xs text-muted-foreground">{step.subtext}</span>
                </span>
                <span
                  aria-hidden
                  className="text-muted-foreground transition-transform group-hover:translate-x-0.5"
                >
                  →
                </span>
              </button>
            </li>
          ))}
        </ol>

        <div className="rounded-lg border border-border bg-muted/40 p-3">
          <p className="text-xs font-medium text-foreground">Testing locally?</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Optional — example throwaway connection strings to try things out.
          </p>
          <div className="mt-2 flex flex-col gap-2">
            {EXAMPLE_CONNECTIONS.map((ex) => (
              <div key={ex.label} className="flex flex-col gap-1">
                <span className="text-[0.65rem] uppercase tracking-wide text-muted-foreground">
                  {ex.label}
                </span>
                <div className="flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded bg-background px-2 py-1 font-mono text-[0.7rem] text-foreground ring-1 ring-border">
                    {ex.value}
                  </code>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Copy ${ex.label} connection string`}
                    onClick={() => void copy(ex.value)}
                  >
                    <Copy />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <DialogFooter>
          <Button ref={getStartedRef} onClick={() => handleOpenChange(false)}>
            Get started
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
