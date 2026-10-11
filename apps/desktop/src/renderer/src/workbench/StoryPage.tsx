// A story's page in the UI Workbench (docs/47): every variant stacked, each with the doc
// comment above its export, in a cell of its own. A cell is its own dialog layer
// (DialogLayer): a variant that is a sheet shows inside its box, so several can be open
// at once; the cell grows to fit it.

import { useLayoutEffect, useState, type ComponentType, type ReactNode } from "react";
import { DialogLayer, ErrorBoundary, LinkButton, SectionHeading } from "@cmd/ui";
import type { StoryInfo } from "./catalog/index.ts";
import { Doc, Head } from "./ComponentPage.tsx";

export type StoryModule = Record<string, unknown>;

/** The variants: the catalog's names in file order that the module exports as components, then any it missed. */
export function variantNames(story: StoryInfo, mod: StoryModule): string[] {
  const isVariant = (k: string) => k !== "args" && k !== "default" && typeof mod[k] === "function";
  const known = story.variants.map((v) => v.name).filter(isVariant);
  return [...known, ...Object.keys(mod).filter((k) => isVariant(k) && !known.includes(k))];
}

export function StoryPage({ story, mod, onFocus }: { story: StoryInfo; mod: StoryModule; onFocus: (variant: string) => void }) {
  const names = variantNames(story, mod);
  return (
    <article className="wb-page">
      <Head title={story.title} file={story.file} doc={story.doc} />
      {names.map((name) => {
        const View = mod[name] as ComponentType;
        const doc = story.variants.find((v) => v.name === name)?.doc;
        return (
          <section key={name} className="wb-section" data-variant={name}>
            <SectionHeading variant="title" aside={<LinkButton onClick={() => onFocus(name)}>Show alone</LinkButton>}>
              {name}
            </SectionHeading>
            {doc && <Doc text={doc} />}
            <Cell>
              <ErrorBoundary title="This variant stopped working" reloadLabel="Reload">
                <View />
              </ErrorBoundary>
            </Cell>
          </section>
        );
      })}
    </article>
  );
}

/** Space a sheet keeps above and below itself in a cell. */
const SHEET_MARGIN = 96;

/** A box for one variant on the story page. */
export const Cell = ({ children }: { children: ReactNode }) => <Layered className="wb-cell wb-variant">{children}</Layered>;

/**
 * A box that is the layer its dialogs go to (its CSS contains fixed positioning), so a sheet
 * covers the box, never the sidebar or the toolbar; it grows to fit its sheets. The children
 * render once the layer exists, so a dialog never moves.
 */
export function Layered({ className, children }: { className: string; children: ReactNode }) {
  const [layer, setLayer] = useState<HTMLDivElement | null>(null);
  const [min, setMin] = useState(0);
  useLayoutEffect(() => {
    if (!layer) return;
    const seen = new Set<Element>();
    const fit = () => {
      const sheets = [...layer.querySelectorAll<HTMLElement>(".ui-dialog")];
      for (const s of sheets) if (!seen.has(s)) (seen.add(s), ro.observe(s));
      setMin(sheets.length ? Math.max(...sheets.map((s) => s.offsetHeight)) + SHEET_MARGIN : 0);
    };
    const ro = new ResizeObserver(fit);
    const mo = new MutationObserver(fit);
    mo.observe(layer, { childList: true, subtree: true });
    fit();
    return () => (ro.disconnect(), mo.disconnect());
  }, [layer]);
  return (
    <div className={className} style={min ? { minHeight: min } : undefined}>
      {layer && <DialogLayer.Provider value={layer}>{children}</DialogLayer.Provider>}
      <div ref={setLayer} className="wb-layer" />
    </div>
  );
}
