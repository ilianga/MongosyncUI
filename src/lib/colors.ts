/**
 * Fixed palette of connection colours used to tag saved connections (Compass-style
 * favourites). Values are hex strings usable inline (e.g. `style={{ background: value }}`).
 */
export const CONNECTION_COLORS = [
  { name: "Green", value: "#00ED64" },
  { name: "Teal", value: "#00684A" },
  { name: "Blue", value: "#016BF8" },
  { name: "Slate", value: "#5C6C75" },
  { name: "Purple", value: "#B45AF2" },
  { name: "Amber", value: "#FFC010" },
  { name: "Red", value: "#DB3030" },
  { name: "Pink", value: "#FF6960" },
] as const;

export type ConnectionColorName = (typeof CONNECTION_COLORS)[number]["name"];

/** The default colour name applied to a connection when none is chosen. */
export const DEFAULT_CONNECTION_COLOR: ConnectionColorName = "Green";

/** Resolve a colour hex value by its palette name; falls back to the default colour. */
export function resolveConnectionColor(name: string | null | undefined): string {
  const fallback = CONNECTION_COLORS.find((c) => c.name === DEFAULT_CONNECTION_COLOR)!.value;
  if (!name) return fallback;
  return CONNECTION_COLORS.find((c) => c.name === name)?.value ?? fallback;
}
