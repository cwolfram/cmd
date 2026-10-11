// The same thing in every built-in theme at once (docs/48): each a .ui-theme subtree with
// the theme's tokens on it, and its own dialog layer inside it, so a sheet takes the theme too.

import type { CSSProperties, ReactNode } from "react";
import { allThemes, themeVars } from "@cmd/ui/themes";
import { Layered, Sized } from "./Layered.tsx";

export function Themes({ width, render }: { width?: number; render: () => ReactNode }) {
  return (
    <div className="wb-themes">
      {allThemes().map((t) => (
        <figure key={t.id} className="wb-theme" data-theme-id={t.id}>
          <figcaption>{t.title}</figcaption>
          <div className="ui-theme wb-themed" data-appearance={t.appearance} style={themeVars(t) as CSSProperties}>
            <Layered className="wb-cell wb-variant">
              <Sized width={width}>{render()}</Sized>
            </Layered>
          </div>
        </figure>
      ))}
    </div>
  );
}
