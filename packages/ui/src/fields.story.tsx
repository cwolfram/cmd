// ShortcutField as Settings → Keyboard Shortcuts uses it: a command's shortcuts, changed in
// place. Click a key to record it again (the slot reads Type a shortcut…), its corner
// badge removes it, + on row hover records another. The caller listens for the keys.
import { useState } from "react";
import { ShortcutField } from "./fields.tsx";
import { FormRow, FormSection } from "./layout.tsx";

/** One command with two shortcuts (click one to record), one with none. */
export const Shortcuts = () => {
  const [keys, setKeys] = useState(["⌘K", "⇧⌘P"]);
  const [rec, setRec] = useState<number | undefined>(undefined);
  return (
    <div style={{ width: 520 }}>
      <FormSection>
        <FormRow title="Command Palette" compact>
          <ShortcutField keys={keys} recording={rec} onRecord={(i) => setRec(rec === i ? undefined : i)} onRemove={(i) => setKeys(keys.filter((_, j) => j !== i))} />
        </FormRow>
        <FormRow title="New Terminal" compact>
          <ShortcutField keys={[]} onRecord={() => {}} onRemove={() => {}} />
        </FormRow>
      </FormSection>
    </div>
  );
};
