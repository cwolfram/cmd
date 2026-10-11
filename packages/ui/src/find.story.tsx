// Find's small pieces: Glyph (text drawn as a toolbar icon, a mark no symbol says) and
// Highlight (a search snippet with its matches marked, \x01…\x02 around each).
import { Glyph, Highlight } from "./find.tsx";

/** The toggles' marks: match case, whole word, regular expression. */
export const Glyphs = () => (
  <div style={{ display: "flex", gap: "var(--space-4)" }}>
    <Glyph>Aa</Glyph>
    <Glyph>ab</Glyph>
    <Glyph>.*</Glyph>
  </div>
);

/** Snippets as transcript search returns them: each match marked. */
export const Snippets = () => (
  <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", width: 420 }}>
    <Highlight text={"…the \x01dock\x02 badge stays at 1 after I answered the agent…"} />
    <Highlight text={"pnpm \x01test\x02 failed: 2 \x01test\x02s in core/osc.\x01test\x02.ts"} />
    <Highlight text="No match marked: the whole line as it is." />
  </div>
);
