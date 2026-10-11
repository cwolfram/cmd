// Keys in settings.json that cmd doesn't know (a typo, a newer cmd's, or one
// removed without a migration): a quiet note each above the page, with a button
// that takes the key out of the file (settings.reset removes unknown keys).

import type { ReactNode } from "react";
import { Button, Callout } from "@cmd/ui";

export function UnknownSettings({ keys, onRemove }: { keys: readonly string[]; onRemove: (key: string) => void }): ReactNode {
  return keys.map((k) => (
    <Callout key={k} tone="neutral" compact actions={<Button size="sm" onClick={() => onRemove(k)}>Remove</Button>}>
      “{k}” in settings.json isn't a setting cmd knows, so it's ignored.
    </Callout>
  ));
}
