"use client";

import { usePathname } from "next/navigation";
import { Sidebar } from "./sidebar";

// Renders the full app shell (sidebar + offset content) for every route except the
// standalone login page, which is shown full-screen without navigation.
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (pathname === "/login") return <>{children}</>;

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      {/* Offset content by sidebar width */}
      <div className="flex min-w-0 flex-1 flex-col pl-16 md:pl-60">
        <main className="flex-1 animate-fade-in px-6 py-6">{children}</main>
      </div>
    </div>
  );
}
