// Icons by SF Symbol name, drawn by the host: the app passes its native renderer
// (<UIProvider icon={Symbol}>, as the UI Workbench does); without one, the kit draws Lucide
// outlines (in a browser). The same names side by side, at the sizes the kit uses.
import { Icon, ICON, UIProvider } from "./icon.tsx";

const NAMES = ["terminal", "folder.fill", "doc.text", "magnifyingglass", "gearshape", "sparkles", "arrow.clockwise", "trash", "chevron.right", "xmark", "checkmark.circle.fill", "exclamationmark.triangle.fill"];

const Grid = () => (
  <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 72px)", gap: "var(--space-3)" }}>
    {NAMES.map((n) => (
      <div key={n} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "var(--space-1)", color: "var(--icon)" }}>
        <Icon name={n} size={ICON.row} />
        <span style={{ font: "var(--text-2xs) var(--font-mono)", color: "var(--text-dim)", textAlign: "center", wordBreak: "break-all" }}>{n}</span>
      </div>
    ))}
  </div>
);

/** The host's renderer (native SF Symbols here). */
export const Native = () => <Grid />;

/** The kit's own: Lucide outlines for the same names, as in a browser. */
export const Lucide = () => (
  <UIProvider>
    <Grid />
  </UIProvider>
);

/** The kit's sizes (ICON): small, row, control, disclosure. */
export const Sizes = () => (
  <div style={{ display: "flex", gap: "var(--space-5)", alignItems: "end", color: "var(--icon)" }}>
    {Object.entries(ICON).map(([k, size]) => (
      <div key={k} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "var(--space-1)" }}>
        <Icon name="sparkles" size={size} />
        <span style={{ font: "var(--text-2xs) var(--font-mono)", color: "var(--text-dim)" }}>
          {k} {size}
        </span>
      </div>
    ))}
  </div>
);
