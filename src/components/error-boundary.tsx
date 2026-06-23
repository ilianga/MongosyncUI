"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Optional custom fallback. Receives the error and a reset callback. */
  fallback?: (error: Error, reset: () => void) => ReactNode;
  /** Optional label shown in the default fallback (e.g. "Charts", "Logs"). */
  label?: string;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Class-based React error boundary for wrapping individual panels/widgets.
 *
 * A render error in one wrapped panel (charts, logs, progress, verification…)
 * is caught here and shown as a small inline "couldn't render" fallback with a
 * retry button, instead of bubbling up and blanking the whole page.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Keep a console trace for debugging; the UI stays graceful.
    if (typeof console !== "undefined") {
      console.error("ErrorBoundary caught an error:", error, info);
    }
  }

  reset = () => {
    this.setState({ error: null });
  };

  render() {
    const { error } = this.state;
    if (error) {
      if (this.props.fallback) return this.props.fallback(error, this.reset);
      const label = this.props.label;
      return (
        <div
          role="alert"
          className="rounded-lg border border-destructive/30 bg-card p-4 text-sm"
        >
          <p className="font-medium text-destructive">
            {label ? `${label} couldn't be displayed` : "This section couldn't be displayed"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            An unexpected error occurred while rendering this panel. The rest of the page is
            still usable.
          </p>
          <button
            type="button"
            onClick={this.reset}
            className="mt-3 inline-flex items-center rounded-md border border-input bg-background px-2.5 py-1 text-xs font-medium transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
