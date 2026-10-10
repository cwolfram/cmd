// Session: moving between the windows on the board (the view's order: the strip stops at its
// ends like PaperWM, other views wrap), to the next one that wants you, and the selected
// agent's session (resume, id, name, summary, folder).

import { copy, copyResumeCommand, summarizeSession } from "../../lib/actions.ts";
import { cmd } from "../../lib/bridge.ts";
import { buildRows, flatten, wantsYou, windowIdOf } from "../../lib/model.ts";
import { select } from "../../lib/selection.ts";
import { openSheet } from "../sheets.ts";
import { registerCommands, type Command, type CommandContext } from "./registry.ts";

const step = (d: number): Command => ({
  when: (c) => c.board.windows.length > 1,
  run: (c) => {
    const order = c.board.order;
    if (!order.length) return;
    const i = order.indexOf(c.selected ?? "");
    const j = c.board.mode === "strip" ? Math.max(0, Math.min(order.length - 1, i + d)) : (i + d + order.length) % order.length;
    if (order[j]) select(order[j]!);
  },
});

/** ⌘1–⌘9: the nth window, the Navigator's order. */
const nth = (n: number): Command => ({
  run: (c) => {
    const id = c.board.windows[n - 1] && windowIdOf(c.board.windows[n - 1]!);
    if (id) select(id);
  },
});

const hasSession = (c: CommandContext) => !!c.session;

registerCommands({
  "session.next": step(1),
  "session.prev": step(-1),
  "session.nextAttention": {
    when: (c) => c.attention > 0,
    run: (c) => {
      // This workspace first, then the others (select switches workspace).
      const target = c.board.allFlat.find(wantsYou) ?? flatten(buildRows(c.state)).find(wantsYou);
      const id = target && windowIdOf(target);
      if (id) select(id);
    },
  },
  "session.copyResume": { when: hasSession, run: (c) => void copyResumeCommand(c.agent!) },
  "session.copyId": { when: hasSession, run: (c) => copy(c.session!) },
  "session.rename": { when: (c) => !!c.agent, run: (c) => openSheet({ kind: "picker", picker: { kind: "renameAgent", agent: c.agent! } }) },
  // Live: ai.updated re-renders when a key is added or stops working.
  "session.summarize": { when: (c) => hasSession(c) && c.aiReady, run: (c) => void summarizeSession(c.agent!) },
  "session.reveal": { when: (c) => !!c.folder, run: (c) => cmd.openPath(c.folder!, { from: "user" }) },
  "session.select1": nth(1),
  "session.select2": nth(2),
  "session.select3": nth(3),
  "session.select4": nth(4),
  "session.select5": nth(5),
  "session.select6": nth(6),
  "session.select7": nth(7),
  "session.select8": nth(8),
  "session.select9": nth(9),
});
