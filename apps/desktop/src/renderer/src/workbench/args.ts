// Props for a component the UI Workbench renders without a story (docs/48): values
// guessed from each prop's kind and name for what is required, `args` from a story for
// what can't be guessed, and the axes of its matrix (its unions and booleans).

import type { ComponentInfo, PropInfo } from "./catalog/index.ts";

export type Args = Record<string, unknown>;

const title = (s: string) => s.replace(/^./, (c) => c.toUpperCase()).replace(/([a-z])([A-Z])/g, "$1 $2");

/** A value for a required prop, or undefined when there is no sensible guess. */
function guess(c: ComponentInfo, p: PropInfo): unknown {
  switch (p.kind) {
    case "union":
      return p.values?.[0];
    case "boolean":
      return false;
    case "number":
      return /value|progress|fraction/i.test(p.name) ? 0.6 : 1;
    case "function":
      return () => {};
    case "node":
      if (p.name === "children") return c.name;
      if (p.name === "icon") return "star";
      return title(p.name);
    case "string":
      if (p.name === "label") return c.name;
      if (p.name === "value" || p.name === "query") return "";
      if (p.name === "icon") return "star";
      return title(p.name);
    case "other":
      // A list of choices (Segmented, Select, RadioGroup) and keys (Kbd).
      if (p.name === "options") return ["One", "Two", "Three"];
      if (p.name === "keys" && /(^|\|)\s*string\s*(\||$)/.test(p.type)) return "⌘K";
      // A plain string among the alternatives (`string | readonly string[]`), not a list of them.
      if (/(^|\|)\s*string\s*(\||$)/.test(p.type)) return title(p.name);
      return undefined;
  }
}

/** Every required prop given, `args` first; `missing` names those without a value. */
export function argsFor(c: ComponentInfo, given: Args = {}): { args: Args; missing: string[] } {
  const args: Args = { ...given };
  const missing: string[] = [];
  const fromOptions = c.props.some((o) => o.name === "options" && o.required);
  for (const p of c.props) {
    // Children are what most components show, required or not (a Button's come from the DOM's types).
    if (p.name in args || (!p.required && !(p.name === "children" && p.kind === "node"))) continue;
    // A choice's value is one of its options (below).
    if (p.name === "value" && fromOptions) continue;
    const v = guess(c, p);
    if (v === undefined) missing.push(p.name);
    else args[p.name] = v;
  }
  // A choice's value is one of its options.
  const options = args.options;
  if (fromOptions && !("value" in args) && c.props.some((p) => p.name === "value" && p.required)) {
    if (Array.isArray(options)) args.value = options[0];
    else missing.push("value");
  }
  return { args, missing };
}

/** Props never laid out as an axis: they open overlays over the page. */
const NOT_AXES = new Set(["open"]);

export interface Matrix {
  /** The first two unions crossed, when that stays small. */
  cross?: { rows: PropInfo; cols: PropInfo };
  /** Every other union and boolean, one row each. */
  rows: PropInfo[];
}

export function matrixOf(c: ComponentInfo): Matrix {
  const axes = c.props.filter((p) => !NOT_AXES.has(p.name) && ((p.kind === "union" && (p.values?.length ?? 0) <= 8) || p.kind === "boolean"));
  const unions = axes.filter((p) => p.kind === "union");
  const [a, b] = unions;
  if (a && b && a.values!.length * b.values!.length <= 48) {
    // The longer one across, so the grid is wider than tall.
    const [cols, rows] = a.values!.length >= b.values!.length ? [a, b] : [b, a];
    return { cross: { rows, cols }, rows: axes.filter((p) => p !== a && p !== b) };
  }
  return { rows: axes };
}

/** An axis's values: a union's, or false and true. */
export const valuesOf = (p: PropInfo): (string | number | boolean)[] => (p.kind === "boolean" ? [false, true] : (p.values ?? []));

/** The prop a component's onChange sets, so a playground or matrix cell follows its own control. */
export function controlledBy(c: ComponentInfo): string | undefined {
  if (!c.props.some((p) => p.name === "onChange")) return undefined;
  return ["value", "checked", "query"].find((n) => c.props.some((p) => p.name === n));
}
