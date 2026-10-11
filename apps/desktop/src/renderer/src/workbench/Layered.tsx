// Boxes for live components in the UI Workbench (docs/47): Layered is its dialogs' layer
// (DialogLayer), so a sheet covers the box, never the sidebar or the toolbar, and several
// can be open at once; Sized puts its content at a window's width.

import { useLayoutEffect, useState, type ReactNode } from "react";
import { DialogLayer } from "@cmd/ui";

/** Space a sheet keeps around itself in a box. */
const SHEET_MARGIN = 96;

/**
 * A box that is the layer its dialogs go to (its CSS contains fixed positioning), so a sheet
 * covers the box, never the sidebar or the toolbar; it grows to fit its sheets. The children
 * render once the layer exists, so a dialog never moves.
 */
export function Layered({ className, children }: { className: string; children: ReactNode }) {
  const [layer, setLayer] = useState<HTMLDivElement | null>(null);
  const [min, setMin] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    if (!layer) return;
    const seen = new Set<Element>();
    const fit = () => {
      const sheets = [...layer.querySelectorAll<HTMLElement>(".ui-dialog")];
      for (const s of sheets) if (!seen.has(s)) (seen.add(s), ro.observe(s));
      // Its set width (a sheet squeezed by a narrow box reports a smaller one), and its height.
      const width = Math.max(0, ...sheets.map((s) => parseFloat(s.style.width) || s.offsetWidth));
      const height = Math.max(0, ...sheets.map((s) => s.offsetHeight));
      setMin(sheets.length ? { width: width + SHEET_MARGIN, height: height + SHEET_MARGIN } : { width: 0, height: 0 });
    };
    const ro = new ResizeObserver(fit);
    const mo = new MutationObserver(fit);
    mo.observe(layer, { childList: true, subtree: true });
    fit();
    return () => (ro.disconnect(), mo.disconnect());
  }, [layer]);
  return (
    <div className={className} style={min.height ? { minWidth: min.width, minHeight: min.height } : undefined}>
      {layer && <DialogLayer.Provider value={layer}>{children}</DialogLayer.Provider>}
      <div ref={setLayer} className="wb-layer" />
    </div>
  );
}

/** At a width (a window's), or as wide as it is. */
export const Sized = ({ width, children }: { width?: number; children: ReactNode }) => (width ? <div className="wb-sized" style={{ width }}>{children}</div> : <>{children}</>);
