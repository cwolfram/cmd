// The design tokens, all of it generated (pnpm tokens → tokens.gen.ts, the themes'
// registry): the colours a theme sets and what derives from them, the type scale, the
// spacing scale, control heights and radii, and every token with its rule for when to use it.
import type { CSSProperties, ReactNode } from "react";
import { DataGrid } from "./grid.tsx";
import { currentTheme } from "./themes/registry.ts";
import { RADII, SPACE, TEXT_SIZES, TOKENS } from "./tokens.gen.ts";

const kebab = (s: string) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
const describe = (name: string) => TOKENS.find((t) => t.name === name)?.description;
const Code = ({ children }: { children: ReactNode }) => <code style={{ font: "var(--text-xs) var(--font-mono)", color: "var(--text-dim)" }}>{children}</code>;

function Swatches({ names }: { names: string[] }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: "var(--space-3)", width: 760 }}>
      {names.map((n) => (
        <div key={n} style={{ display: "flex", flexDirection: "column", gap: "var(--space-1-5)" }} data-tip={describe(n)}>
          <span style={{ height: 40, borderRadius: "var(--radius)", background: `var(${n})`, boxShadow: "inset 0 0 0 1px var(--separator)" }} />
          <Code>{n}</Code>
        </div>
      ))}
    </div>
  );
}

/** What the active theme sets (its colours, by the names it uses). */
export const ThemeColours = () => <Swatches names={Object.keys(currentTheme().colors).map((k) => `--${kebab(k)}`)} />;

/** Colours derived from the theme's in the token files (hovering one says when to use it). */
export const Derived = () => <Swatches names={TOKENS.filter((t) => t.type === "color" && !t.value.startsWith("theme:")).map((t) => t.name)} />;

/** The type scale: each size with a line set in it, and the code font. */
export const Type = () => (
  <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: "var(--space-2) var(--space-4)", alignItems: "baseline", width: 760 }}>
    {TEXT_SIZES.map((s) => [
      <Code key={`c${s}`}>--text-{s}</Code>,
      <span key={s} style={{ fontSize: `var(--text-${s})` }} data-tip={describe(`--text-${s}`)}>
        Agents, terminals and windows
      </span>,
    ])}
    <Code>--font-mono</Code>
    <span style={{ font: "var(--text-md) var(--font-mono)" }}>~/src/cmd $ pnpm workbench</span>
  </div>
);

/** The spacing scale: multiples of 4px, each drawn to size with its rule. */
export const Spacing = () => (
  <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: "var(--space-2) var(--space-4)", alignItems: "center", width: 760 }}>
    {SPACE.map((s) => [
      <Code key={`c${s}`}>--space-{s}</Code>,
      <span key={s} style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
        <span style={{ width: `var(--space-${s})`, height: 12, background: "var(--accent)", borderRadius: "var(--radius-xs)" }} />
        <span style={{ color: "var(--text-dim)", fontSize: "var(--text-sm)" }}>{describe(`--space-${s}`)}</span>
      </span>,
    ])}
  </div>
);

/** Control heights and corner radii, as boxes. */
export const Shapes = () => {
  const box = (label: string, style: CSSProperties) => (
    <div key={label} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "var(--space-1-5)" }}>
      <span style={{ width: 56, background: "var(--control-bg)", boxShadow: "inset 0 0 0 1px var(--control-edge)", ...style }} />
      <Code>{label}</Code>
    </div>
  );
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-4)", alignItems: "flex-end" }}>
      {TOKENS.filter((t) => /^--control-h(-[a-z]+)?$/.test(t.name) && t.type !== "color").map((t) => box(t.name, { height: `var(${t.name})`, borderRadius: "var(--radius)" }))}
      {RADII.map((r) => box(`--radius-${r}`, { height: 40, borderRadius: `var(--radius-${r})` }))}
    </div>
  );
};

/** Every token from packages/ui/tokens (DTCG): value, its light-theme value, and when to use it. */
export const All = () => (
  <div style={{ width: 900, height: 480, display: "flex" }}>
    <DataGrid
      columns={[
        { key: "name", label: "Token" },
        { key: "value", label: "Value" },
        { key: "light", label: "Light themes", hide: "regular" },
        { key: "description", label: "When", grow: true },
      ]}
      rows={TOKENS.map((t) => [{ node: t.name, kind: "text" }, { node: t.value, tip: t.value }, t.light ?? "", { node: t.description ?? "", tip: t.description }])}
      mono
    />
  </div>
);
