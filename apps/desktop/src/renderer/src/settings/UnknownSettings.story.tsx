// The notes above a Settings page for keys in settings.json that cmd doesn't
// know, over the danger callout a file that doesn't parse gets.
import { Callout, Stack } from "@cmd/ui";
import { UnknownSettings } from "./UnknownSettings.tsx";

/** Two unknown keys under an error, as the page shows them. */
export const Default = () => (
  <Stack gap={3} style={{ width: 560 }}>
    <Callout tone="danger">font.codeSize: expected a number</Callout>
    <UnknownSettings keys={["canvas.zoomz", "terminal.ligatures"]} onRemove={() => {}} />
  </Stack>
);
