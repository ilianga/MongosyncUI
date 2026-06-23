import { describe, it, expect, vi } from "vitest";
import { isValidElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ErrorBoundary } from "../error-boundary";

/**
 * The test environment is `node` (no jsdom), so these tests exercise the class
 * directly and render returned elements to static HTML via react-dom/server,
 * rather than mounting into a DOM. (react-dom/server does not run client-side
 * error-boundary catching, so the catch path is verified via the static
 * getDerivedStateFromError + fallback-render contract.)
 */

describe("ErrorBoundary", () => {
  it("renders children when there is no error", () => {
    const html = renderToStaticMarkup(
      <ErrorBoundary>
        <p>healthy content</p>
      </ErrorBoundary>,
    );
    expect(html).toContain("healthy content");
  });

  it("derives error state from a thrown error", () => {
    const err = new Error("kaboom");
    const next = ErrorBoundary.getDerivedStateFromError(err);
    expect(next.error).toBe(err);
  });

  it("renders the default fallback (with label) once in the error state", () => {
    // Drive the instance into the error state, then render its output.
    const instance = new ErrorBoundary({ children: null, label: "Charts" });
    instance.state = ErrorBoundary.getDerivedStateFromError(new Error("kaboom"));

    const output = instance.render();
    expect(isValidElement(output)).toBe(true);

    const html = renderToStaticMarkup(output as ReactElement);
    expect(html).toContain("Charts couldn&#x27;t be displayed");
    expect(html).toContain("Try again");
    expect(html).toContain('role="alert"');
  });

  it("uses a custom fallback when provided", () => {
    const fallback = vi.fn((e: Error) => <span>custom: {e.message}</span>);
    const instance = new ErrorBoundary({ children: null, fallback });
    instance.state = ErrorBoundary.getDerivedStateFromError(new Error("kaboom"));

    const html = renderToStaticMarkup(instance.render() as ReactElement);
    expect(fallback).toHaveBeenCalled();
    expect(html).toContain("custom: kaboom");
  });

  it("reset clears the error state via setState", () => {
    const instance = new ErrorBoundary({ children: null });
    instance.state = { error: new Error("kaboom") };
    const setState = vi.fn();
    // Stub React's setState (not wired up outside a mounted tree).
    instance.setState = setState as unknown as typeof instance.setState;

    instance.reset();
    expect(setState).toHaveBeenCalledWith({ error: null });
  });
});
