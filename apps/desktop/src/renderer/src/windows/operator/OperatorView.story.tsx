// The Operator widget with stand-in conversations, every state: loading, empty, AI not set up,
// a turn at work (looks folded, an act on a window, a streaming answer), an approval waiting,
// news from an agent it started, a stopped turn and a failed one, and every size.

import type { OperatorConversation, OperatorItem } from "@cmd/protocol";
import { AllSizes, RefWindow, type SizeName } from "../../reference/RefWindow.tsx";
import { Operator, type OperatorWorld } from "./OperatorView.tsx";

const NOW = Date.now();
const NAMES: Record<string, string> = { t1: "pnpm test", t2: "Claude · Parser", t3: "zsh — api" };
const world: OperatorWorld = { useName: (id) => NAMES[id] ?? null, goTo: () => {}, answer: async () => {} };

let n = 0;
const user = (text: string): OperatorItem => ({ kind: "user", id: `u${n++}`, at: NOW, text });
const text = (t: string): OperatorItem => ({ kind: "text", id: `x${n++}`, at: NOW, text: t });
const tool = (name: string, why: string, o: Partial<Extract<OperatorItem, { kind: "tool" }>> = {}): OperatorItem => ({ kind: "tool", id: `s${n++}`, at: NOW, tool: name, why, acts: false, target: null, state: "done", input: {}, ms: 120, ...o });
const conv = (items: OperatorItem[], o: Partial<OperatorConversation> = {}): OperatorConversation => ({ workspaceId: "ws", name: "Parser tests", items, busy: false, usage: { input: 0, output: 0, cacheRead: 0 }, model: null, latency: null, ...o });

const TURN: OperatorItem[] = [
  user("Run the tests and start an agent on whatever fails."),
  tool("look", "Looking at the board"),
  tool("run", "Running the tests", { acts: true, target: "t1", ms: 14_200, output: "Started “test” (pnpm test)." }),
  tool("read", "Reading the failures", { target: "t1" }),
  tool("events", "Checking what changed since the last green run"),
  tool("agent", "Starting Claude on the failing parser test", { acts: true, target: "t2", ms: 3_100 }),
  text("Two tests fail in `osc.test.ts`, both in the parser:\n\n- **OSC 133 D** loses its exit status when the mark is split across reads.\n- **OSC 7** paths with spaces come back unescaped.\n\nClaude is on it; I'll tell you when it's done."),
];

const frame = (c: OperatorConversation | null, o: { size?: SizeName; needsAi?: boolean } = {}) => (
  <RefWindow icon="brain" name={c?.name ?? "Operator"} size={o.size}>
    <Operator conv={c} needsAi={!!o.needsAi} focused={false} world={world} onSend={() => {}} onStop={() => {}} onNew={() => {}} onPast={() => {}} />
  </RefWindow>
);

/** Nothing asked yet: what it does. */
export const Empty = () => frame(conv([], { name: null }));

/** No AI provider: it says how to set one up. */
export const NeedsAi = () => frame(conv([], { name: null }), { needsAi: true });

/** Its conversation not loaded yet. */
export const Loading = () => frame(null);

/** A turn: the request, looks folded into a row, acts with the window they're about, the answer. */
export const Turn = () => frame(conv(TURN));

/** At work: a step running, the answer streaming, Stop in the prompt. */
export const Working = () => frame(conv([...TURN.slice(0, 4), tool("agent", "Starting Claude on the failing parser test", { acts: true, target: "t2", state: "running", ms: undefined }), text("Two tests fail in")], { busy: true }));

/** Waiting for the person: exactly what it would type, and where. */
export const Approval = () =>
  frame(conv([user("Migrate the staging database."), tool("look", "Looking at the board"), tool("type", "Running the staging migration", { acts: true, target: "t3", state: "waiting", ms: undefined, ask: "Type in the terminal in api", exact: "pnpm db:migrate --env staging  ⏎" })], { busy: true }));

/** News from an agent it started, and the turn it began by itself. */
export const News = () => frame(conv([...TURN, { kind: "event", id: "e1", at: NOW, text: "Claude “Parser” is done." }, tool("read", "Reading what Claude changed", { target: "t2" }), text("Claude fixed both: the parser now keeps a split mark until it's whole, and OSC 7 paths are unescaped. The tests pass.")]));

/** A stopped turn, a denied step, and one that failed. */
export const Stopped = () =>
  frame(conv([user("Clean up the build folders."), tool("type", "Deleting dist", { acts: true, target: "t3", state: "denied", output: "The person said no." }), { kind: "error", id: "st", at: NOW, text: "Stopped." }, user("Deploy it."), { kind: "error", id: "er", at: NOW, text: "Something went wrong: the provider is overloaded." }]));

/** A turn at each size. */
export const Sizes = () => <AllSizes render={(size) => frame(conv(TURN), { size })} />;
