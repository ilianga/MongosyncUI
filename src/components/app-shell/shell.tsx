"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Sidebar } from "./sidebar";
import CommandPalette from "./command-palette";
import FirstRunDialog from "@/components/first-run-dialog";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "mongosyncui:sidebar-collapsed";

// Renders the full app shell (sidebar + offset content) for every route except the
// standalone login page, which is shown full-screen without navigation.
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  // Persisted, user-controlled sidebar collapse. Default expanded; read from
  // localStorage after mount. We suppress the width/padding transition until
  // hydration so restoring a collapsed rail on reload doesn't animate on first paint.
  const [collapsed, setCollapsed] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    // Defer to a microtask so the state update isn't applied synchronously inside
    // the effect (avoids the cascading-render lint rule) while still resolving
    // before the browser paints the restored layout.
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      try {
        setCollapsed(localStorage.getItem(STORAGE_KEY) === "1");
      } catch {
        /* ignore (private mode / disabled storage) */
      }
      setHydrated(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  function toggle() {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  if (pathname === "/login") return <>{children}</>;

  return (
    <div className="flex min-h-screen">
      <Sidebar collapsed={collapsed} onToggle={toggle} />
      {/* Offset content by sidebar width; follows the collapsed state so content
          reclaims space when the rail collapses. */}
      <div
        className={cn(
          "flex min-w-0 flex-1 flex-col transition-[padding] duration-200 ease-out",
          collapsed ? "pl-16" : "pl-16 md:pl-60",
          !hydrated && "[transition:none]"
        )}
      >
        <main className="flex-1 animate-fade-in px-6 py-6">{children}</main>
      </div>
      {/* Global, headless chrome: ⌘K command palette + first-run onboarding. Both render
          nothing until triggered (keyboard / first-visit / custom event). */}
      <CommandPalette />
      <FirstRunDialog />
    </div>
  );
}
