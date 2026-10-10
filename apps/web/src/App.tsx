// The phone's screens (docs/13-remote-access.md, "Experience"): pairing, from
// the link or from the Mac's code scanned or pasted in Add a Mac (Pairing.tsx),
// then Now and a terminal per row, with the connection's state in words
// throughout (connecting, offline since…, not paired anymore). A browser can be
// paired with several Macs (identity.ts); it opens the one used last, and the
// settings sheet switches. A pairing link pairs only when the person says so,
// in every browser, and offers installing the app as the other choice (install.ts).

import { useEffect, useState, useSyncExternalStore } from "react";
import { bucketOf } from "@cmd/protocol";
import { Button, Callout, IconButton, StatusDot } from "@cmd/ui";
import { Connection, pair, type Phase } from "./connection.ts";
import { forgetIdentity, listMacs, loadIdentity, macKey, touchIdentity, type Identity, type Mac } from "./identity.ts";
import { itemOf, useModel } from "./model.ts";
import { Now } from "./Now.tsx";
import { AddMac, PairLink } from "./Pairing.tsx";
import { MacsSheet, Settings } from "./Settings.tsx";
import { TerminalScreen } from "./Terminal.tsx";
import { Center } from "./ui.tsx";

type Screen =
  | { kind: "loading" }
  /** Add a Mac; `back` is the Mac to return to on Cancel. */
  | { kind: "add"; back: Connection | null }
  /** A pairing link, held in memory until the person taps Pair This Browser. */
  | { kind: "link"; fragment: string }
  | { kind: "pairing"; words: string[] | null; error: string | null; back: Connection | null }
  | { kind: "paired"; conn: Connection; n: number };

let started = 0;

export function App() {
  const [screen, setScreen] = useState<Screen>({ kind: "loading" });

  const show = (id: Identity) => {
    const conn = new Connection(id);
    conn.start();
    void touchIdentity(macKey(id.hostKey), { lastUsed: Date.now() }).catch(() => {});
    setScreen({ kind: "paired", conn, n: ++started });
  };
  /** The Mac with this key, or, without one, the one used last; Add a Mac when there's none. */
  const open = async (key?: string) => {
    const macs = await listMacs().catch(() => [] as Mac[]);
    for (const k of key ? [key, ...macs.map((m) => m.key)] : macs.map((m) => m.key)) {
      const id = await loadIdentity(k).catch(() => undefined);
      if (id) return show(id);
    }
    setScreen({ kind: "add", back: null });
  };
  const startPairing = (fragment: string, back: Connection | null) => {
    setScreen({ kind: "pairing", words: null, error: null, back });
    pair(fragment, (words) => setScreen({ kind: "pairing", words, error: null, back })).then(
      (id) => (back?.close(), show(id)),
      (err: Error) => setScreen({ kind: "pairing", words: null, error: err.message, back }),
    );
  };
  const forget = async (conn: Connection) => {
    conn.close();
    await forgetIdentity(conn.key).catch(() => {});
    await open();
  };
  const switchTo = (conn: Connection, key: string) => {
    if (key === conn.key) return;
    conn.close();
    void open(key);
  };

  useEffect(() => {
    const fragment = location.pathname.endsWith("/pair") ? location.hash : "";
    if (fragment.length > 1) {
      // The fragment holds a one-time key: out of the address bar and history at once.
      history.replaceState(null, "", "/");
      // Never on load: the key is single use, and this browser may not be where the person wants cmd.
      setScreen({ kind: "link", fragment });
      return;
    }
    void open();
  }, []);

  switch (screen.kind) {
    case "loading":
      return <Center icon="terminal" title="cmd" />;
    case "add": {
      const back = screen.back;
      return (
        <AddMac
          title={back ? "Add a Mac" : "Pair with Your Mac"}
          onPair={(f) => startPairing(f, back)}
          onCancel={back ? () => setScreen({ kind: "paired", conn: back, n: ++started }) : undefined}
        />
      );
    }
    case "link":
      return <PairLink onPair={() => startPairing(screen.fragment, null)} />;
    case "pairing": {
      const back = screen.back;
      if (screen.error)
        return (
          <Center
            icon="xmark.octagon"
            title="Couldn't pair"
            action={
              <Button size="lg" variant="primary" icon="qrcode.viewfinder" onClick={() => setScreen({ kind: "add", back })}>
                Scan Again
              </Button>
            }
          >
            {screen.error}
          </Center>
        );
      if (!screen.words) return <Center icon="lock" title="Pairing…" />;
      return (
        <Center icon="lock" title="Approve on your Mac">
          Check that your Mac shows these words:
          <div className="words">
            {screen.words.map((w, i) => (
              <span key={i}>{w}</span>
            ))}
          </div>
        </Center>
      );
    }
    case "paired": {
      const conn = screen.conn;
      return (
        <Paired
          key={screen.n}
          conn={conn}
          onAdd={() => setScreen({ kind: "add", back: conn })}
          onSwitch={(key) => switchTo(conn, key)}
          onForget={() => void forget(conn)}
        />
      );
    }
  }
}

function usePhase(conn: Connection): Phase {
  return useSyncExternalStore(
    (fn) => conn.onChange(fn),
    () => conn.phase,
  );
}

interface MacActions {
  onAdd: () => void;
  onSwitch: (key: string) => void;
  onForget: () => void;
}

function Paired({ conn, onAdd, onSwitch, onForget }: { conn: Connection } & MacActions) {
  const phase = usePhase(conn);
  const model = useModel(conn, phase);
  const [open, setOpen] = useState<string | null>(null);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [settings, setSettings] = useState(false);
  const [macs, setMacs] = useState(false);
  const actions = { onAdd, onSwitch, onForget };

  // Before the Mac answers there's no settings sheet, but switching to another Mac still works.
  const others = <MacsSheet open={macs} current={conn.key} currentName={conn.identity.name} onAdd={onAdd} onSwitch={onSwitch} onClose={() => setMacs(false)} />;
  const switchMac = (
    <Button size="lg" variant="ghost" onClick={() => setMacs(true)}>
      Switch Mac
    </Button>
  );

  if (phase.kind === "refused")
    return (
      <>
        <Center
          icon="lock"
          title="Not paired anymore"
          action={
            <>
              <Button size="lg" onClick={onForget}>
                Forget This Mac
              </Button>
              {switchMac}
            </>
          }
        >
          Your Mac doesn't know this browser now. Pair again from cmd → Settings → Remote Access.
        </Center>
        {others}
      </>
    );
  if (!model)
    return (
      <>
        {phase.kind === "offline" ? (
          <Center icon="wifi.slash" title={`${conn.identity.name ?? "Your Mac"} is offline`} action={switchMac}>
            {offlineText(phase)}
          </Center>
        ) : (
          <Center icon="terminal" title="Connecting…" />
        )}
        {others}
      </>
    );

  const pane = open ? model.panes.get(open) : undefined;
  const openPane = (id: string) => {
    setOpen(id);
    const p = model.panes.get(id);
    const a = p?.agentId ? model.agents.get(p.agentId) : undefined;
    if (a && bucketOf(a) !== "rest") void conn.client?.call("agent.markSeen", { agentId: a.id }).catch(() => {});
    if (p?.attention) void conn.client?.call("pane.clearAttention", { paneId: id }).catch(() => {});
  };

  return (
    <div className="app">
      {pane ? (
        <TerminalScreen key={pane.id} conn={conn} item={itemOf(model, pane)} control={model.scope === "control"} onBack={() => setOpen(null)} />
      ) : (
        <>
          <header className="bar">
            <div className="bar-title">
              <h1>Now</h1>
              <span className="status">
                <StatusDot state={phase.kind === "online" ? "success" : phase.kind === "offline" ? "warning" : "off"} size="sm" /> {model.host}
              </span>
            </div>
            <IconButton icon="gearshape" size="lg" label="Settings" onClick={() => setSettings(true)} />
          </header>
          {phase.kind === "offline" && (
            <Callout tone="warning" banner>
              {offlineText(phase)}
            </Callout>
          )}
          <Now conn={conn} model={model} workspaceId={workspaceId} onWorkspace={setWorkspaceId} onOpen={openPane} />
        </>
      )}
      {pane && phase.kind === "offline" && (
        <div className="floating">
          <Callout tone="warning">{offlineText(phase)}</Callout>
        </div>
      )}
      <Settings open={settings} conn={conn} phase={phase} model={model} {...actions} onClose={() => setSettings(false)} />
    </div>
  );
}

const offlineText = (p: Extract<Phase, { kind: "offline" }>) =>
  `${p.reason === "mac" ? "It may be asleep, or remote access is off." : "Can't reach it right now."} Since ${new Date(p.since).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}. Retrying…`;
