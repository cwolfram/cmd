// A story's page in the UI Workbench (docs/48): every variant stacked, each with the doc
// comment above its export, in a cell of its own. A cell is its own dialog layer
// (DialogLayer): a variant that is a sheet shows inside its box, so several can be open
// at once; the cell grows to fit it.

import type { ComponentType } from "react";
import { ErrorBoundary, LinkButton, SectionHeading } from "@cmd/ui";
import type { StoryInfo } from "./catalog/index.ts";
import { Doc, Head } from "./ComponentPage.tsx";
import { Cell, Sized } from "./Layered.tsx";

export type StoryModule = Record<string, unknown>;

/** The variants: the catalog's names in file order that the module exports as components, then any it missed. */
export function variantNames(story: StoryInfo, mod: StoryModule): string[] {
  const isVariant = (k: string) => k !== "args" && k !== "default" && typeof mod[k] === "function";
  const known = story.variants.map((v) => v.name).filter(isVariant);
  return [...known, ...Object.keys(mod).filter((k) => isVariant(k) && !known.includes(k))];
}

export function StoryPage({ story, mod, width, onFocus }: { story: StoryInfo; mod: StoryModule; width?: number; onFocus: (variant: string) => void }) {
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
              <Sized width={width}>
                <ErrorBoundary title="This variant stopped working" reloadLabel="Reload">
                  <View />
                </ErrorBoundary>
              </Sized>
            </Cell>
          </section>
        );
      })}
    </article>
  );
}


