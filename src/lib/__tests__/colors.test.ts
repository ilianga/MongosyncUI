import { describe, it, expect } from "vitest";
import {
  CONNECTION_COLORS,
  DEFAULT_CONNECTION_COLOR,
  resolveConnectionColor,
} from "@/lib/colors";

describe("colors", () => {
  it("exposes a non-empty palette of {name, value} entries with hex values", () => {
    expect(CONNECTION_COLORS.length).toBeGreaterThan(0);
    for (const c of CONNECTION_COLORS) {
      expect(c.name).toBeTruthy();
      expect(c.value).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });

  it("has a default colour that exists in the palette", () => {
    expect(CONNECTION_COLORS.some((c) => c.name === DEFAULT_CONNECTION_COLOR)).toBe(true);
  });

  it("resolves a known colour name to its hex value", () => {
    const blue = CONNECTION_COLORS.find((c) => c.name === "Blue")!;
    expect(resolveConnectionColor("Blue")).toBe(blue.value);
  });

  it("falls back to the default colour for unknown/empty names", () => {
    const fallback = resolveConnectionColor(DEFAULT_CONNECTION_COLOR);
    expect(resolveConnectionColor(undefined)).toBe(fallback);
    expect(resolveConnectionColor(null)).toBe(fallback);
    expect(resolveConnectionColor("Nonexistent")).toBe(fallback);
  });
});
