// Remote access's methods (docs/13-remote-access.md), merged into Methods (rpc.ts). The Mac
// manages it; a phone can only call what packages/core/src/remote/policy.ts allows, and
// is told what remoteResult and remoteEvent there let through.

import type { Agent, AppWindow, Pane, RemoteAccessCheck, RemoteAccessMode, RemoteDevice, RemoteLogEntry, RemoteScope, RemoteStatus, RemoteTheme, Workspace, WindowTypeInfo } from "./model.ts";

export interface RemoteMethods {
  "remote.status": { params: {}; result: RemoteStatus };
  /** Turn remote access on or off (the remote.enabled setting); off closes every session, paired devices stay. */
  "remote.enable": { params: {}; result: RemoteStatus };
  "remote.disable": { params: {}; result: RemoteStatus };
  /** A one-time pairing link (show it as a QR code); valid for 5 minutes, replaces any earlier one. */
  "remote.pair": { params: { scope?: RemoteScope }; result: { url: string; expiresAt: number } };
  /** Answer a remote.pairRequest. */
  "remote.approve": { params: { requestId: string; allow: boolean; scope?: RemoteScope }; result: null };
  "remote.devices": { params: {}; result: RemoteDevice[] };
  /** Close live sessions (one device's, or all) without unpairing; devices may reconnect. */
  "remote.disconnect": { params: { id?: string }; result: null };
  /** Recent activity, newest first. */
  "remote.log": { params: { limit?: number }; result: RemoteLogEntry[] };
  /** The access modes this core has, the choices for remote.access. */
  "remote.modes": { params: {}; result: RemoteAccessMode[] };
  /** The setup checklist of an access mode (default: remote.access); empty when it has nothing to set up. */
  "remote.checks": { params: { access?: string }; result: RemoteAccessCheck[] };
  /** "Check Again": publish the current access mode again if it isn't, then its checklist. */
  "remote.setup": { params: {}; result: RemoteAccessCheck[] };
  /** Unpair a device and close its sessions. */
  "remote.revoke": { params: { id: string }; result: null };
  /** Change a device's scope; its sessions reconnect with it. */
  "remote.setScope": { params: { id: string; scope: RemoteScope }; result: RemoteDevice };
  /**
   * A device has read `received` characters of what its session sent (in all). From its
   * first ack the Mac keeps at most a window of output unread by it, and resyncs a
   * terminal past that, instead of the relay dropping a slow phone (AR1-12-07).
   */
  "remote.ack": { params: { received: number }; result: null };
  /**
   * What a remote session starts from (instead of events.subscribe): a projection
   * without settings, UI state or secrets. After it the session receives the
   * events the policy lets through.
   */
  "remote.bootstrap": {
    params: {};
    result: {
      panes: Pane[];
      agents: Agent[];
      windows: AppWindow[];
      workspaces: Workspace[];
      windowTypes: WindowTypeInfo[];
      device: { id: string; scope: RemoteScope } | null;
      /** This Mac, as the phone names it ("Jan's MacBook Pro"). */
      host: { name: string };
      /** The Mac's theme settings, so the phone looks the same (cores before 0.25 leave it out). */
      theme: RemoteTheme;
      /** Web Push: the Mac's VAPID key (base64url) and whether this device is subscribed; older cores leave it out. */
      push?: { key: string; subscribed: boolean };
    };
  };
  /** A paired device's push subscription (PushSubscription.toJSON()); replaces the one it had. Remote sessions only. */
  "push.subscribe": { params: { endpoint: string; keys: { p256dh: string; auth: string } }; result: null };
  /** This device gets no more pushes. Remote sessions only. */
  "push.unsubscribe": { params: {}; result: null };
  /** The app on this Mac: is the screen locked, and how long since the last input (for remote.push.when "away"). Its connection's: gone when it closes. */
  "ui.presence": { params: { idleSeconds: number; locked: boolean }; result: null };
  /** Whether this session's page is in front: while one is, its device shows notifications itself and gets no push. Remote sessions only. */
  "push.visible": { params: { visible: boolean }; result: null };
}
