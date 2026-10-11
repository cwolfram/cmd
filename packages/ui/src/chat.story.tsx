// A conversation with an agent that acts (the Operator): requests, answers, steps in every state,
// a step waiting for approval, a note when a turn was stopped.
import { ChatApproval, ChatMessage, ChatNote, ChatStep } from "./chat.tsx";
import { Stack } from "./frame.tsx";
import { CodeBlock } from "./layout.tsx";

const frame = { width: 420 };

/** A turn: the request, steps as they ran (looks quiet, acts with the window they're about), the answer. */
export const Conversation = () => (
  <div style={frame}>
    <Stack gap={3}>
      <ChatMessage from="person">Run the tests and start an agent on whatever fails.</ChatMessage>
      <Stack gap={0}>
        <ChatStep icon="eye" title="Looking at the board" state="done" quiet time="0.1s" />
        <ChatStep icon="play" title="Running the tests" state="done" target="w3" onTarget={() => {}} time="14.2s">
          <CodeBlock>{"pnpm test\n✗ 2 failed, 312 passed"}</CodeBlock>
        </ChatStep>
        <ChatStep icon="text.alignleft" title="Reading the failures" state="done" quiet target="w3" onTarget={() => {}} time="0.2s" />
        <ChatStep icon="person.badge.plus" title="Starting Claude on the failing parser test" state="running" target="w5" onTarget={() => {}} />
      </Stack>
      <ChatMessage from="agent">
        <p>
          Two tests fail in <code>osc.test.ts</code>. Claude is on it in <strong>w5</strong>; I'll tell you when it's done.
        </p>
      </ChatMessage>
    </Stack>
  </div>
);

/** Every state a step can be in. */
export const Steps = () => (
  <div style={frame}>
    <Stack gap={0}>
      <ChatStep icon="eye" title="Looking at the board" state="done" quiet time="0.1s" />
      <ChatStep icon="play" title="Running the dev server" state="running" target="w2" onTarget={() => {}} />
      <ChatStep icon="keyboard" title="Typing the migration command" state="waiting" target="w4" onTarget={() => {}} />
      <ChatStep icon="xmark.circle" title="Closing the build terminal" state="failed" target="w6" time="0.0s">
        <CodeBlock tone="danger">w6 is closed: look again</CodeBlock>
      </ChatStep>
      <ChatStep icon="keyboard" title="Typing rm -rf dist" state="denied" target="w4" />
    </Stack>
  </div>
);

/** A step waiting for the person: in words, exactly, and the three answers. */
export const Approval = () => (
  <div style={frame}>
    <ChatApproval title="Type in w4" exact="pnpm db:migrate --env staging" onAnswer={() => {}} />
  </div>
);

/** A streaming answer, and the note a stopped turn leaves. */
export const Streaming = () => (
  <div style={frame}>
    <Stack gap={3}>
      <ChatMessage from="agent" streaming>
        <p>The dev server is up on localhost:5173. Opening it next to</p>
      </ChatMessage>
      <ChatNote>Stopped.</ChatNote>
      <ChatNote tone="danger">Something went wrong: the provider is overloaded.</ChatNote>
    </Stack>
  </div>
);
