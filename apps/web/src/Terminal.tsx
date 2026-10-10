// A terminal on the phone (prototype; docs/13, "Terminals on a phone"). The
// page never scrolls: the terminal fills what's left above the keyboard and
// only its scrollback scrolls. With control access it sizes the Mac's terminal
// to that space (pane.fitOverride) while it's shown, and refits as the
// keyboard opens and closes or the phone rotates; leaving, locking the phone or
// disconnecting gives the Mac its size back. If the Mac takes it back (someone
// types there), the phone shows the Mac's size scaled down until you tap Fit.
// View-only devices always show the Mac's size, scaled to fit. Above it: the
// state line (what the agent is doing or asking), below it a key row (with a
// sticky ctrl) and a compose bar; the menu switches sizing and closes it.

import { useEffect, useRef, useState } from "react";
import { Button, Dialog, IconButton, ListRow, StatusDot, TextField, Icon } from "@cmd/ui";
import { terminalColors, useTheme } from "@cmd/ui/themes";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import type { Pane } from "@cmd/protocol";
import type { Connection } from "./connection.ts";
import { stateText, type Item } from "./model.ts";
import { Screen } from "./screen.ts";

const FONT = 13;
const MIN_FONT = 5;
/** A cell's size per point of font size (monospace, xterm's default line height). */
const CELL_W = 0.6;
const CELL_H = 1.2;
/** The range the core accepts (remote/policy.ts). */
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

const KEYS: { label: string; data: string; wide?: boolean }[] = [
  { label: "esc", data: "\x1b" },
  { label: "tab", data: "\t" },
  { label: "⇧tab", data: "\x1b[Z", wide: true },
  { label: "↑", data: "\x1b[A" },
  { label: "↓", data: "\x1b[B" },
  { label: "←", data: "\x1b[D" },
  { label: "→", data: "\x1b[C" },
  { label: "^C", data: "\x03" },
  { label: "|", data: "|" },
  { label: "~", data: "~" },
  { label: "/", data: "/" },
  { label: "-", data: "-" },
  { label: "⏎", data: "\r" },
];

/** ctrl + a key: its control character (ctrl-c → \x03), else the key as is. */
function withCtrl(data: string): string {
  const c = data[0];
  if (!c || data.length !== 1) return data;
  const code = c.toUpperCase().charCodeAt(0);
  if (code >= 64 && code <= 95) return String.fromCharCode(code - 64);
  if (c === " ") return "\x00";
  return data;
}

export function TerminalScreen({ conn, item, control, onBack }: { conn: Connection; item: Item; control: boolean; onBack: () => void }) {
  const pane: Pane = item.pane;
  const host = useRef<HTMLDivElement>(null);
  const term = useRef<{ t: Terminal; fit: FitAddon; screen: Screen } | null>(null);
  /** Sizes the terminal (the size effect's), again once a snapshot is parsed. */
  const sizeRef = useRef<() => void>(() => {});
  const [text, setText] = useState("");
  /** This phone sizes the terminal (else: the Mac's size, scaled). */
  const [fitting, setFitting] = useState(control);
  const holding = useRef(false);
  /** The core confirmed our size (sizedBy set) since we asked: a null after that means the Mac took it back. */
  const confirmed = useRef(false);
  const [ctrl, setCtrl] = useState(false);
  const ctrlRef = useRef(false);
  ctrlRef.current = ctrl;
  const [menu, setMenu] = useState(false);
  const theme = useTheme();
  const colors = terminalColors(theme);
  const client = conn.client;
  const send = (data: string) => void client?.call("pane.write", { paneId: pane.id, data }).catch(() => {});
  /** Keys typed or tapped; a sticky ctrl applies to the next one. */
  const write = (data: string) => {
    if (ctrlRef.current) {
      setCtrl(false);
      return send(withCtrl(data));
    }
    send(data);
  };

  // The terminal: snapshot, then live output for this pane only (window.follow).
  useEffect(() => {
    const t = new Terminal({
      cols: pane.cols,
      rows: pane.rows,
      fontSize: FONT,
      fontFamily: '"SF Mono", ui-monospace, Menlo, monospace',
      disableStdin: !control,
      scrollback: 5000,
      theme: terminalColors(theme),
    });
    const fit = new FitAddon();
    t.loadAddon(fit);
    t.open(host.current!);
    // Written at the snapshot's size; no resizing until it is parsed, then the size again.
    const screen = new Screen(t);
    screen.onParsed = () => sizeRef.current();
    term.current = { t, fit, screen };
    if (control) t.onData((d) => write(d));
    let live = true;
    const snapshot = async () => {
      screen.awaitSnapshot();
      const snap = await client?.call("pane.snapshot", { paneId: pane.id });
      if (!live || !snap) return;
      screen.snapshot(snap);
    };
    const off = conn.onEvent((e) => {
      if (e.type === "pane.output" && e.paneId === pane.id) screen.output(e.data, e.seq);
      else if (e.type === "pane.resync" && e.paneId === pane.id) void snapshot();
    });
    void client?.call("window.follow", { ids: [pane.id] }).then(snapshot, () => {});
    return () => {
      live = false;
      off();
      void client?.call("window.follow", { ids: [] }).catch(() => {});
      if (holding.current) void client?.call("pane.fitOverride", { paneId: pane.id, release: true }).catch(() => {});
      holding.current = false;
      confirmed.current = false;
      term.current = null;
      t.dispose();
    };
  }, [conn, pane.id, client]);

  // The Mac's theme changed (or Auto followed the phone): repaint.
  useEffect(() => {
    if (term.current) term.current.t.options.theme = terminalColors(theme);
  }, [theme]);

  // Size: fit the space (and the Mac's terminal to it), or scale the Mac's size into it.
  useEffect(() => {
    const el = host.current!;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const apply = () => {
      const x = term.current;
      if (!x || !el.clientWidth || !el.clientHeight) return;
      if (fitting && document.visibilityState === "visible") {
        x.t.options.fontSize = FONT;
        const d = x.fit.proposeDimensions();
        if (!d || !Number.isFinite(d.cols) || !Number.isFinite(d.rows)) return;
        const cols = clamp(d.cols, 20, 300);
        const rows = clamp(d.rows, 5, 200);
        x.screen.resize({ cols, rows }, () => {
          if (holding.current && pane.cols === cols && pane.rows === rows) return;
          holding.current = true;
          void client?.call("pane.fitOverride", { paneId: pane.id, cols, rows }).catch(() => {});
        });
      } else {
        x.screen.resize({ cols: pane.cols, rows: pane.rows });
        x.t.options.fontSize = Math.max(MIN_FONT, Math.min(FONT, el.clientWidth / (pane.cols * CELL_W), el.clientHeight / (pane.rows * CELL_H)));
      }
    };
    sizeRef.current = apply;
    // The keyboard and rotation change the space in steps; settle before resizing the PTY.
    const later = () => (clearTimeout(timer), (timer = setTimeout(apply, 120)));
    const ro = new ResizeObserver(later);
    ro.observe(el);
    // Locked or switched away: give the Mac its size back; refit on return.
    const vis = () => {
      if (document.visibilityState === "hidden" && holding.current) {
        holding.current = false;
        confirmed.current = false;
        void client?.call("pane.fitOverride", { paneId: pane.id, release: true }).catch(() => {});
      } else later();
    };
    document.addEventListener("visibilitychange", vis);
    apply();
    return () => (clearTimeout(timer), ro.disconnect(), document.removeEventListener("visibilitychange", vis));
  }, [fitting, pane.cols, pane.rows, pane.id, client]);

  // The Mac took it back (someone typed there): stop fitting until asked again.
  useEffect(() => {
    if (!holding.current) return;
    if (pane.sizedBy !== null) confirmed.current = true;
    else if (confirmed.current) {
      holding.current = false;
      confirmed.current = false;
      setFitting(false);
    }
  }, [pane.sizedBy]);

  const submit = () => {
    if (!text) return;
    write(text + "\r");
    setText("");
  };
  const paste = async () => {
    try {
      const t = await navigator.clipboard.readText();
      if (t) send(`\x1b[200~${t}\x1b[201~`);
    } catch {}
  };

  return (
    <div className="term-screen" style={{ background: colors.background }}>
      <header className="bar term-bar">
        <IconButton icon="chevron.left" size="lg" label="Back to Now" onClick={onBack} />
        <div className="term-head">
          <div className="term-name">
            <StatusDot state={item.light} size="sm" /> <span>{item.title}</span>
          </div>
          <div className="term-state">
            {item.workspace ? `${item.workspace} · ` : ""}
            {stateText(item)}
            {item.detail ? ` · ${item.detail}` : ""}
          </div>
        </div>
        <IconButton icon="ellipsis" size="lg" label="More" onClick={() => setMenu(true)} />
      </header>
      <div className="term" ref={host} />
      {control ? (
        <div className="term-input">
          <div className="keys">
            <Button size="sm" className="key" pressed={ctrl} onClick={() => setCtrl(!ctrl)}>
              ctrl
            </Button>
            {KEYS.map((k) => (
              <Button key={k.label} size="sm" className="key" onClick={() => write(k.data)}>
                {k.label}
              </Button>
            ))}
            <Button size="sm" className="key" icon="doc.on.clipboard" aria-label="Paste" onClick={() => void paste()} />
          </div>
          <form className="compose" onSubmit={(e) => (e.preventDefault(), submit())}>
            <IconButton icon="keyboard" size="lg" label="Type into the terminal" onClick={() => term.current?.t.focus()} />
            <TextField
              fill
              size="lg"
              value={text}
              onChange={setText}
              placeholder={ctrl ? "ctrl + a key…" : "Message or command"}
              aria-label="Message or command"
              enterKeyHint="send"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
            />
            <Button type="submit" size="lg" variant="primary" icon="arrow.up" disabled={!text} aria-label="Send" />
          </form>
        </div>
      ) : (
        <div className="viewonly">
          <Icon name="lock" size={14} /> View only. Your Mac can allow control in Settings → Remote Access.
        </div>
      )}
      <Dialog open={menu} onClose={() => setMenu(false)} title={item.title} padded={false}>
        <TerminalMenu conn={conn} pane={pane} control={control} fitting={fitting} onFit={(v) => (setFitting(v), setMenu(false))} onClosed={() => (setMenu(false), onBack())} />
      </Dialog>
    </div>
  );
}

function TerminalMenu(p: { conn: Connection; pane: Pane; control: boolean; fitting: boolean; onFit: (v: boolean) => void; onClosed: () => void }) {
  const [confirm, setConfirm] = useState(false);
  if (!p.control) return <p className="note padded">View only: this phone shows the Mac's terminal at the Mac's size.</p>;
  return (
    <div className="menu-rows">
      <ListRow
        role="button"
        icon="arrow.up.left.and.arrow.down.right"
        title={p.fitting ? "Use the Mac's Size" : "Fit to This Phone"}
        detail={p.fitting ? `Now ${p.pane.cols}×${p.pane.rows}, sized for this phone` : "The Mac's terminal takes this screen's size while you look at it"}
        onClick={() => p.onFit(!p.fitting)}
      />
      <ListRow
        role="button"
        icon="xmark"
        markTone="danger"
        title={confirm ? "Tap Again to Close" : "Close Terminal"}
        detail="Ends what runs in it, on the Mac too"
        tone="danger"
        onClick={() => {
          if (!confirm) return setConfirm(true);
          void p.conn.client?.call("pane.kill", { paneId: p.pane.id }).catch(() => {});
          p.onClosed();
        }}
      />
    </div>
  );
}
