export async function register() {
  // initApp uses better-sqlite3 + child_process — Node runtime only.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { initApp } = await import("@/lib/init");
    initApp();
  }
}
