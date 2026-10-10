// Workspace Actions' section of the Settings window (settings/layout.ts places it):
// its keys are ACTIONS_SETTINGS (protocol actions.ts).

import type { Section } from "../../settings/layout.ts";

export const actionsSettings: Section = { title: "Workspace Actions", items: ["actions.describe", "actions.openBrowser"] };
