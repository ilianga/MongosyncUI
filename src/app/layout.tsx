import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/theme-provider";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "MongosyncUI",
  description: "Manage MongoDB cluster-to-cluster migrations",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={inter.className}>
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
          <div className="min-h-screen bg-background">
            <header className="border-b">
              <div className="container mx-auto flex h-14 items-center px-4">
                <a href="/" className="text-lg font-semibold">MongosyncUI</a>
                <nav className="ml-auto flex gap-4">
                  <a href="/" className="text-sm text-muted-foreground hover:text-foreground">Dashboard</a>
                  <a href="/settings" className="text-sm text-muted-foreground hover:text-foreground">Settings</a>
                </nav>
              </div>
            </header>
            <main className="container mx-auto px-4 py-6">{children}</main>
          </div>
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
