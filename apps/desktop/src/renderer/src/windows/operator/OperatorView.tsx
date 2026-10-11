// The Operator widget (docs/51): the workspace's conversation with the Operator, newest last
// and kept in sight while it streams, its steps as rows (looks folded together, acts with the
// window they're about), a card for each approval it waits for, and the prompt under it. The
// conversation lives in the core: closing this window doesn't stop a turn.

import { useEffect, useMemo, useRef, useState } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import type { OperatorConversation, OperatorItem, WindowId } from "@cmd/protocol";
import { AiField, Button, Callout, ChatApproval, ChatMessage, ChatNote, ChatStep, CodeBlock, Stack, Text, ToolbarButton, ToolbarSpacer, View, WindowToolbar, useStickToEnd } from "@cmd/ui";
import { showContextMenu } from "../../lib/context.ts";
import { useAiStatus } from "../../ai/status.ts";
import { showSetup } from "../../onboarding/Onboarding.tsx";
import { getState, getWorkspaceView, useStoreValue } from "../../lib/store.ts";
import { ago, fieldsOf, type SidebarRow } from "../../lib/model.ts";
import { durationText, goTo } from "../../lib/widgets.ts";
import { cmd } from "../../lib/bridge.ts";
import type { WindowViewProps } from "../registry.ts";
import { operatorCall, useOperator } from "./operator.ts";

type Tool = Extract<OperatorItem, { kind: "tool" }>;

/** Each tool's icon (SF Symbols). */
const ICONS: Record<string, string> = {
  look: "eye",
  read: "text.alignleft",
  run: "play",
  agent: "person.badge.plus",
  wait: "hourglass",
  type: "keyboard",
  open: "plus.rectangle",
  close: "xmark.rectangle",
  focus: "scope",
  search: "magnifyingglass",
  events: "clock.arrow.circlepath",
};

const EXAMPLES = ["Run the tests and start an agent on whatever fails", "What did my agents do today?", "Start the dev server and open it in a browser", "Close the terminals that are done"];

/** What the conversation shows, in order: messages, single steps, runs of looks folded into one row. */
type Block = { kind: "item"; item: OperatorItem } | { kind: "looks"; items: Tool[] };

function blocks(items: OperatorItem[]): Block[] {
  const out: Block[] = [];
  for (const item of items) {
    const quiet = item.kind === "tool" && !item.acts && item.state !== "waiting";
    const last = out.at(-1);
    if (quiet && last?.kind === "looks") last.items.push(item as Tool);
    else if (quiet) out.push({ kind: "looks", items: [item as Tool] });
    else out.push({ kind: "item", item });
  }
  return out;
}

const markdown = (text: string) => DOMPurify.sanitize(marked.parse(text, { gfm: true, async: false }) as string);

/** "this": the window selected before the Operator's own, if it is still open in the Operator's workspace. */
function thisWindow(win: { id: WindowId; workspaceId: string }): WindowId | null {
  const s = getState();
  const here = (id: WindowId) => (s.windows.get(id)?.workspaceId ?? s.panes.get(id)?.workspaceId) === win.workspaceId;
  const history = getWorkspaceView<WindowId[]>(win.workspaceId, "selection.history", []);
  return history.find((id) => id !== win.id && here(id)) ?? null;
}

export function OperatorView({ win, focused }: WindowViewProps) {
  const ws = win.workspaceId;
  const conv = useOperator(ws);
  const ai = useAiStatus();
  const [draft, setDraft] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const body = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  // Selected (Ask Operator…, a click on its title): the cursor goes to the prompt.
  useEffect(() => {
    if (focused) field.current?.focus();
  }, [focused]);
  const { toEnd } = useStickToEnd(body, [conv?.items]);
  const needsAi = !!ai && !ai.ready;

  const send = (text: string) => {
    if (needsAi) return showSetup(["ai"]);
    setDraft("");
    setHistory((h) => [text, ...h.filter((x) => x !== text)].slice(0, 50));
    toEnd();
    void operatorCall.send(ws, text, thisWindow(win)).catch(() => {});
  };

  const empty = !!conv && !conv.items.length;
  return (
    <Stack gap={0} grow>
      <View
        inset
        bodyRef={body}
        toolbar={
          <WindowToolbar label="Operator">
            <ToolbarButton icon="square.and.pencil" label="New Conversation" disabled={!conv?.items.length} onClick={() => void operatorCall.reset(ws).catch(() => {})} />
            <ToolbarSpacer />
            <ToolbarButton icon="clock.arrow.circlepath" label="Past Conversations" menu onClick={() => void showPast(ws)} />
          </WindowToolbar>
        }
        state={
          !conv
            ? { kind: "loading" }
            : empty
              ? { kind: "empty", icon: "brain", title: "Ask the Operator", text: "It runs this workspace while you watch: tests, agents, dev servers. It asks before it types anything." }
              : null
        }
      >
        {conv && <Conversation conv={conv} workspaceId={ws} />}
      </View>
      <Stack pad="inset" gap={2}>
        {needsAi && (
          <Callout compact tone="accent" icon="sparkles" actions={<Button size="sm" onClick={() => showSetup(["ai"])}>Set Up AI…</Button>}>
            The Operator needs an AI model. Connect Anthropic or OpenAI first.
          </Callout>
        )}
        {empty && !needsAi && (
          <Stack gap={1}>
            {EXAMPLES.map((x) => (
              <Button key={x} size="sm" variant="ghost" onClick={() => send(x)}>
                {x}
              </Button>
            ))}
          </Stack>
        )}
        <AiField
          ref={field}
          value={draft}
          onChange={setDraft}
          onSubmit={send}
          onStop={() => void operatorCall.stop(ws)}
          state={conv?.busy ? "thinking" : "idle"}
          history={history}
          placeholder={conv?.busy ? "Working…" : "What should I do?"}
          autoFocus={focused}
          aria-label="Ask the Operator"
        />
        {conv && conv.usage.input > 0 && <Usage conv={conv} />}
      </Stack>
    </Stack>
  );
}

/** Past conversations, newest first: picking one goes back to it (the current one is put away). */
async function showPast(workspaceId: string): Promise<void> {
  const past = await cmd.call("operator.history", { workspaceId }).catch(() => []);
  const now = Date.now();
  await showContextMenu(
    past.length
      ? past.slice(0, 30).map((p) => ({ label: `${p.title.length > 60 ? p.title.slice(0, 59) + "…" : p.title}  ·  ${ago(p.at, now)}`, run: () => void operatorCall.open(workspaceId, p.id).catch(() => {}) }))
      : [{ label: "No past conversations yet", run: () => {}, enabled: false }],
  );
}

function Usage({ conv }: { conv: OperatorConversation }) {
  const tokens = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));
  const parts = [conv.model, `${tokens(conv.usage.input)} in, ${tokens(conv.usage.output)} out`];
  if (conv.latency && !conv.busy) parts.push(`first step ${conv.latency.firstStepMs === null ? "—" : durationText(conv.latency.firstStepMs)}, all ${durationText(conv.latency.totalMs)}`);
  return (
    <Text size="xs" tone="dim">
      {parts.filter(Boolean).join(" · ")}
    </Text>
  );
}

function Conversation({ conv, workspaceId }: { conv: OperatorConversation; workspaceId: string }) {
  const shown = useMemo(() => blocks(conv.items), [conv.items]);
  const lastText = [...conv.items].reverse().find((i) => i.kind === "text")?.id;
  return (
    <Stack gap={3}>
      {shown.map((b, i) =>
        b.kind === "looks" ? (
          <Looks key={b.items[0]!.id} items={b.items} workspaceId={workspaceId} />
        ) : (
          <Item key={b.item.id} item={b.item} workspaceId={workspaceId} streaming={conv.busy && b.item.id === lastText && i === shown.length - 1} />
        ),
      )}
    </Stack>
  );
}

function Item({ item, workspaceId, streaming }: { item: OperatorItem; workspaceId: string; streaming: boolean }) {
  switch (item.kind) {
    case "user":
      return (
        <ChatMessage from="person" copy={item.text}>
          {item.text}
        </ChatMessage>
      );
    case "text":
      return (
        <ChatMessage from="agent" streaming={streaming} copy={item.text}>
          <div dangerouslySetInnerHTML={{ __html: markdown(item.text) }} />
        </ChatMessage>
      );
    case "event":
      return <ChatStep icon="bell" title={item.text} state="done" />;
    case "error":
      return <ChatNote tone={item.text === "Stopped." ? undefined : "danger"}>{item.text}</ChatNote>;
    case "tool":
      return item.state === "waiting" && item.ask ? <Approval item={item} workspaceId={workspaceId} /> : <Step item={item} workspaceId={workspaceId} />;
  }
}

function Step({ item, workspaceId, quiet }: { item: Tool; workspaceId: string; quiet?: boolean }) {
  const input = Object.keys(item.input).length ? JSON.stringify(item.input, null, 2) : null;
  return (
    <ChatStep
      icon={ICONS[item.tool] ?? "gearshape"}
      title={item.why}
      state={item.state}
      quiet={quiet}
      target={item.target ? <WindowName id={item.target} /> : undefined}
      onTarget={item.target ? () => goTo(item.target!, workspaceId) : undefined}
      time={item.ms !== undefined ? durationText(item.ms) : undefined}
    >
      {(input || item.output || item.ask) && (
        <>
          {item.ask && <Text size="sm">Asked: {item.ask}</Text>}
          {item.exact && <CodeBlock>{item.exact}</CodeBlock>}
          {input && <CodeBlock>{input}</CodeBlock>}
          {item.output && <CodeBlock tone={item.state === "failed" ? "danger" : undefined}>{item.output}</CodeBlock>}
        </>
      )}
    </ChatStep>
  );
}

/** The window a step is about, by its title as the board shows it (the Operator's refs are for its tools). */
function WindowName({ id }: { id: WindowId }) {
  const name = useStoreValue((s) => {
    const pane = s.panes.get(id) ?? null;
    const win = s.windows.get(id) ?? null;
    if (!pane && !win) return null;
    const agent = pane?.agentId ? (s.agents.get(pane.agentId) ?? null) : null;
    return fieldsOf({ key: id, pane, win, agent, children: [], urgent: agent } as SidebarRow, undefined, 0).name;
  });
  return <>{name ?? "Closed window"}</>;
}

function Looks({ items, workspaceId }: { items: Tool[]; workspaceId: string }) {
  const [open, setOpen] = useState(false);
  if (items.length === 1) return <Step item={items[0]!} workspaceId={workspaceId} quiet />;
  const running = items.some((i) => i.state === "running");
  const failed = items.some((i) => i.state === "failed");
  return (
    <Stack gap={0}>
      <ChatStep icon="eye" quiet title={open ? `${items.length} looks` : (items.find((i) => i.state === "running") ?? items.at(-1)!).why} state={running ? "running" : failed ? "failed" : "done"} time={open ? undefined : `${items.length} steps`}>
        <Stack gap={0}>
          {!open && (
            <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
              Show Each Step
            </Button>
          )}
          {open && items.map((i) => <Step key={i.id} item={i} workspaceId={workspaceId} quiet />)}
        </Stack>
      </ChatStep>
    </Stack>
  );
}

function Approval({ item, workspaceId }: { item: Tool; workspaceId: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <ChatApproval
      title={item.ask}
      exact={item.exact}
      busy={busy}
      onAnswer={(allow, reason) => {
        setBusy(true);
        void operatorCall.answer(workspaceId, item.id, allow, reason).catch(() => setBusy(false));
      }}
    />
  );
}
