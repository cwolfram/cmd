// Overlays that need more than a native menu or confirm: a menu with icons, details and
// shortcuts; a popover card; a sheet whose content works while it shows (Presence); a
// confirmation; toasts. The menus, popover and confirmation start open.
import { useEffect, useRef, useState } from "react";
import { Button, ButtonGroup } from "./button.tsx";
import { KeyValue, SectionHeading } from "./layout.tsx";
import { ConfirmDialog, Dialog, Menu, Popover, Presence, Toast, Toaster, toast } from "./overlay.tsx";
import { StatusDot } from "./status.tsx";

const WORKSPACES = { work: "Work", home: "Home", side: "Side project", long: "fl-studio-canonical-store-migration" } as const;
type Workspace = keyof typeof WORKSPACES;

/** A workspace switcher: a heading, checkmarks, shortcuts, a separator, a destructive item with Undo. Arrow keys, Enter, type to jump. */
export const Workspaces = () => {
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(true);
  const [ws, setWs] = useState<Workspace>("work");
  return (
    <div style={{ height: 300 }}>
      <Button ref={anchor} trailing="chevron.up.chevron.down" onClick={() => setOpen(!open)}>
        {WORKSPACES[ws]}
      </Button>
      <Menu
        anchor={anchor}
        open={open}
        onClose={() => setOpen(false)}
        items={[
          "Workspaces",
          { label: "Work", detail: "4 windows · 2 agents", icon: "terminal", checked: ws === "work", shortcut: "⌃1", onSelect: () => setWs("work") },
          { label: "Home", detail: "1 window", icon: "house", checked: ws === "home", shortcut: "⌃2", onSelect: () => setWs("home") },
          { label: "Side project", icon: "sparkles", checked: ws === "side", shortcut: "⌃3", onSelect: () => setWs("side") },
          null,
          { label: "New Workspace…", icon: "plus", onSelect: () => toast("New Workspace") },
          { label: "Delete Workspace", icon: "trash", danger: true, onSelect: () => toast("Deleted", { tone: "danger", action: { label: "Undo", run: () => toast("Restored") } }) },
        ]}
      />
    </div>
  );
};

/** One line per item: the current row tinted instead of a checkmark, details beside the labels, accessories before shortcuts; as wide as its widest item up to maxWidth, then the detail gives way. */
export const Inline = () => {
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(true);
  const [ws, setWs] = useState<Workspace>("work");
  return (
    <div style={{ height: 280, width: 480, display: "flex", justifyContent: "center" }}>
      <Button ref={anchor} trailing="chevron.down" onClick={() => setOpen(!open)}>
        {WORKSPACES[ws]}
      </Button>
      <Menu
        anchor={anchor}
        open={open}
        onClose={() => setOpen(false)}
        align="center"
        marks="row"
        inline
        width="content"
        maxWidth={400}
        items={[
          { label: "Work", detail: "~/src/work", icon: "terminal", checked: ws === "work", shortcut: "⌃1", onSelect: () => setWs("work") },
          { label: "Home", detail: "~", icon: "house", checked: ws === "home", accessory: <StatusDot state="needs" size="sm" />, shortcut: "⌃2", onSelect: () => setWs("home") },
          { label: "Side project", detail: "~/src/side-project", icon: "sparkles", checked: ws === "side", accessory: <StatusDot state="unseen" size="sm" />, shortcut: "⌃3", onSelect: () => setWs("side") },
          { label: "fl-studio-canonical-store-migration", detail: "~/src/fl-studio-canonical-store-migration · worktree of fl-studio-store", icon: "folder", checked: ws === "long", shortcut: "⌃4", onSelect: () => setWs("long") },
          null,
          { label: "Open Workspace…", icon: "plus", shortcut: "⌘O", onSelect: () => toast("Open Workspace") },
        ]}
      />
    </div>
  );
};

/** A card under its button: details and an action (the core's status in the footer). */
export const Card = () => {
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(true);
  return (
    <div style={{ height: 220 }}>
      <Button ref={anchor} icon="info.circle" onClick={() => setOpen(!open)}>
        Core details
      </Button>
      <Popover anchor={anchor} open={open} onClose={() => setOpen(false)} width={280}>
        <div style={{ padding: "var(--space-2) var(--space-3)", display: "flex", flexDirection: "column", gap: "var(--space-1-5)" }}>
          <SectionHeading aside={<StatusDot state="unseen" size="sm" />}>Core</SectionHeading>
          <KeyValue
            items={[
              ["Build", "4f670fc"],
              ["Uptime", "3h 12m"],
              ["Terminals", "7"],
            ]}
          />
          <ButtonGroup align="end">
            <Button size="sm">Restart</Button>
          </ButtonGroup>
        </div>
      </Popover>
    </div>
  );
};

/** Polls while it's mounted; Presence keeps it mounted while shown and while it fades out, then not at all. */
function PollingSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [polls, setPolls] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setPolls((n) => n + 1), 50);
    return () => clearInterval(t);
  }, []);
  return (
    <Dialog open={open} onClose={onClose} title="Task Manager" width={360} position="center" actions={<Button onClick={onClose}>Done</Button>}>
      Polled {polls} times since it opened.
    </Dialog>
  );
}

/** A sheet whose content does work: it stops polling once closed. */
export const Mounted = () => {
  const [shown, setShown] = useState(false);
  return (
    <>
      <Button onClick={() => setShown(true)}>Task Manager…</Button>
      <Presence when={shown}>{(_, open) => <PollingSheet open={open} onClose={() => setShown(false)} />}</Presence>
    </>
  );
};

/** Asking before something that can't be undone: the danger button is the confirm. */
export const Confirm = () => {
  const [open, setOpen] = useState(true);
  return (
    <>
      <Button variant="danger" onClick={() => setOpen(true)}>
        Delete Workspace…
      </Button>
      <ConfirmDialog open={open} danger title="Delete “Side project”?" confirm="Delete" onCancel={() => setOpen(false)} onConfirm={() => setOpen(false)}>
        Its 3 windows close. Terminals in it are ended.
      </ConfirmDialog>
    </>
  );
};

/** Toasts in place, each tone, one with an action. */
export const Toasts = () => (
  <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", width: 360 }}>
    <Toast onDismiss={() => {}}>Copied path</Toast>
    <Toast tone="success" icon="checkmark.circle.fill" onDismiss={() => {}}>
      Widget rebuilt
    </Toast>
    <Toast tone="warning" icon="exclamationmark.triangle.fill" action={{ label: "Undo", run: () => {} }} onDismiss={() => {}}>
      Window closed
    </Toast>
  </div>
);

/** toast() from anywhere, shown by the window's Toaster at its corner (the UI Workbench has one; this is a second, so each shows twice in place). */
export const Toasting = () => (
  <div style={{ display: "flex", gap: "var(--space-2)" }}>
    <Button onClick={() => toast("Copied path")}>Plain</Button>
    <Button onClick={() => toast("Widget rebuilt", { tone: "success", icon: "checkmark.circle.fill" })}>Success</Button>
    <Button onClick={() => toast("Window closed", { action: { label: "Undo", run: () => toast("Reopened") } })}>With action</Button>
    <Toaster />
  </div>
);
