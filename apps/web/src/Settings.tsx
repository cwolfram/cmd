// The settings sheet: which Mac this is, how it's reached, what this device may
// do, and Forget This Mac (the Mac keeps listing it until unpaired there).

import { useState } from "react";
import { Button, Callout, Dialog, KeyValue } from "@cmd/ui";
import type { Connection, Phase } from "./connection.ts";
import { deviceName, forgetIdentity } from "./identity.ts";
import type { Model } from "./model.ts";

export function Settings({ open, conn, phase, model, onClose }: { open: boolean; conn: Connection; phase: Phase; model: Model; onClose: () => void }) {
  const [confirm, setConfirm] = useState(false);
  const address = conn.identity.socket.replace(/^wss?:\/\//, "");
  const status = phase.kind === "online" ? "Connected" : phase.kind === "offline" ? "Offline" : "Connecting…";
  const close = () => (setConfirm(false), onClose());
  return (
    <Dialog open={open} onClose={close} title={model.host} label="Settings">
      <KeyValue
        items={[
          ["Status", status],
          ["This device", deviceName()],
          ["Access", model.scope === "control" ? "Control: can type and change files" : "View only"],
          ["Address", address],
        ]}
      />
      <Callout icon="lock">End-to-end encrypted. Anything in between sees only scrambled bytes; your Mac decides who gets in.</Callout>
      <Button
        size="lg"
        variant="danger"
        icon="xmark"
        onClick={() => {
          if (!confirm) return setConfirm(true);
          conn.close();
          void forgetIdentity().then(() => location.reload());
        }}
      >
        {confirm ? "Tap Again to Forget" : "Forget This Mac"}
      </Button>
      <p className="note">This browser drops its key. Unpair it on the Mac too, in Settings → Remote Access.</p>
    </Dialog>
  );
}
