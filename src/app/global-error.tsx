"use client";

import { useEffect } from "react";
import "./globals.css";

/**
 * Global error boundary — replaces the root layout when an error is thrown in
 * the layout itself. It must render its own <html> and <body>. Kept dependency-
 * free (no shared providers/components may be available here).
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    if (typeof console !== "undefined") console.error("Global error:", error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0a0a0a",
          color: "#fafafa",
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
        }}
      >
        <div style={{ maxWidth: 420, padding: 24, textAlign: "center" }}>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="#00ED64"
            width="32"
            height="32"
            aria-hidden="true"
            style={{ marginBottom: 16 }}
          >
            <path d="M17 8C8 10 5.9 16.17 3.82 21.34L5.71 22l1-2.3A4.49 4.49 0 0 0 8 20C19 20 22 3 22 3c-1 2-8 2-8 8z" />
          </svg>
          <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>Something went wrong</h1>
          <p style={{ marginTop: 8, fontSize: 14, color: "#a1a1a1" }}>
            A critical error occurred. Try reloading the application.
          </p>
          {error?.digest && (
            <p style={{ marginTop: 8, fontSize: 12, color: "#737373", fontFamily: "monospace" }}>
              Ref: {error.digest}
            </p>
          )}
          <div style={{ marginTop: 24, display: "flex", gap: 12, justifyContent: "center" }}>
            <button
              type="button"
              onClick={reset}
              style={{
                cursor: "pointer",
                borderRadius: 8,
                border: "none",
                background: "#00ED64",
                color: "#0a0a0a",
                fontWeight: 500,
                fontSize: 14,
                padding: "8px 14px",
              }}
            >
              Try again
            </button>
            <button
              type="button"
              onClick={() => window.location.assign("/")}
              style={{
                cursor: "pointer",
                borderRadius: 8,
                border: "1px solid #2a2a2a",
                background: "transparent",
                color: "#fafafa",
                fontWeight: 500,
                fontSize: 14,
                padding: "8px 14px",
              }}
            >
              Go home
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
