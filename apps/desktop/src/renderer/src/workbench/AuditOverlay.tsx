// The audit drawn over the stage (audit.ts): each window part's content box, dashed, and its
// distances to the part's edges; red where a rule is broken. Re-measured as the page changes,
// scrolls or resizes. Above everything, and never in the way of the pointer.

import { useEffect, useState } from "react";
import { audit, type AuditRow } from "./audit.ts";

export function AuditOverlay({ root }: { root: () => Element | null }) {
  const [rows, setRows] = useState<AuditRow[]>([]);
  useEffect(() => {
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setRows(root() ? audit(root()!).rows : []));
    };
    // Not its own redraws.
    const mo = new MutationObserver((list) => list.some((m) => !(m.target instanceof Element ? m.target : m.target.parentElement)?.closest(".wb-audit")) && measure());
    mo.observe(document.body, { childList: true, subtree: true, characterData: true });
    addEventListener("resize", measure);
    addEventListener("scroll", measure, true);
    measure();
    return () => (cancelAnimationFrame(frame), mo.disconnect(), removeEventListener("resize", measure), removeEventListener("scroll", measure, true));
  }, [root]);
  return (
    <div className="wb-audit" aria-hidden>
      {rows.map((r, i) => {
        const bad = r.problems.length > 0;
        const mid = (r.ink.top + r.ink.bottom) / 2;
        return (
          <div key={i} data-bad={bad || undefined}>
            <div className="wb-audit-ink" style={{ top: r.ink.top, left: r.ink.left, width: r.ink.right - r.ink.left, height: r.ink.bottom - r.ink.top }} />
            <div className="wb-audit-gap" style={{ top: mid, left: r.frame.left, width: r.left }} />
            <div className="wb-audit-gap" style={{ top: mid, left: r.ink.right, width: r.right }} />
            <span className="wb-audit-tag" style={{ top: r.ink.top, left: r.ink.left }} title={r.problems.join("; ")}>
              {r.part} {r.part === "body" ? `↑${r.top} ` : ""}←{r.left} →{r.right}
              {bad ? ` ✗ ${r.problems.join("; ")}` : ""}
            </span>
          </div>
        );
      })}
    </div>
  );
}
