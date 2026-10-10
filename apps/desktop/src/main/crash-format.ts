// What a crash report looks like on its way out (main/crash.ts): the Discord
// message, home folders scrubbed, and the signature that recognises a repeat.

import { createHash } from "node:crypto";
import os from "node:os";
import type { CrashReport } from "@cmd/protocol/node";

/** Same process, kind, message (numbers, ids and paths aside) and top frame: the same crash. */
export function signature(r: Pick<CrashReport, "process" | "kind" | "message" | "stack">): string {
  const norm = (s: string) =>
    s
      .replace(/(\/|[A-Z]:\\)[^\s:'"()]+/g, "<path>")
      .replace(/\b(?=[0-9a-f-]*\d)[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}\b|\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{8,}\b/gi, "<id>")
      .replace(/0x[0-9a-f]+|\b\d+\b/gi, "N");
  const frame = r.stack?.split("\n").find((l) => l.trim().startsWith("at ")) ?? "";
  return createHash("sha1").update([r.process, r.kind, norm(r.message), norm(frame)].join("\n")).digest("hex");
}

/** Home folders become ~ (the user name is in the path). */
export function scrub(s: string): string {
  const home = os.homedir();
  let out = home ? s.split(home).join("~") : s;
  out = out.replace(/\/(Users|home)\/[^/\s"'\\]+/g, "~").replace(/[A-Z]:\\\\?Users\\\\?[^\\\s"']+/gi, "~");
  return out;
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export interface Payload {
  username: string;
  embeds: { title: string; description?: string; color: number; fields: { name: string; value: string; inline: boolean }[]; footer: { text: string }; timestamp: string }[];
}

/** A report's message: `repeats`, how often the same crash came again since it was posted, `last` when (ms). */
export function payload(r: CrashReport, repeats = 0, last?: number): Payload {
  const c = r.context;
  const fields = [
    { name: "Version", value: `${c.version ?? "?"} (${c.channel ?? "?"})`, inline: true },
    { name: "Process", value: `${r.process} · ${r.kind}`, inline: true },
    { name: "Platform", value: c.platform ?? "?", inline: true },
    ...Object.entries(c)
      .filter(([k, v]) => !["version", "channel", "platform"].includes(k) && v)
      .map(([k, v]) => ({ name: k, value: clip(scrub(v), 200), inline: true })),
  ];
  if (repeats > 0) fields.push(repeatsField(repeats, last));
  const stack = r.stack ? scrub(r.stack) : r.log.length ? scrub(r.log.slice(-15).join("\n")) : "";
  return {
    username: "cmd crashes",
    embeds: [
      {
        title: clip(scrub(`${r.process}: ${r.message}`), 250),
        description: stack ? `\`\`\`\n${clip(stack.replace(/```/g, "'''"), 3800)}\n\`\`\`` : undefined,
        color: c.channel === "dev" ? 0xf5a524 : 0xe5484d,
        fields: fields.slice(0, 24), // room for Repeats, added later by withRepeats
        footer: { text: r.id },
        timestamp: r.time,
      },
    ],
  };
}

const repeatsField = (n: number, last?: number) => ({
  name: "Repeats",
  value: `${n} more${last ? `, last <t:${Math.round(last / 1000)}:R>` : ""}`,
  inline: true,
});

/** A posted message again, saying how often the crash came back since (the post is edited, not repeated). */
export function withRepeats(p: Payload, repeats: number, last: number): Payload {
  const [e, ...rest] = p.embeds;
  if (!e) return p;
  return { ...p, embeds: [{ ...e, fields: [...e.fields.filter((f) => f.name !== "Repeats"), repeatsField(repeats, last)] }, ...rest] };
}
