// RpcClient's hello: once the core listed its methods, has() answers from that
// list and call() refuses a missing one without sending it.

import { describe, expect, it } from "vitest";
import { RpcClient, UNKNOWN_METHOD, type CoreHello } from "../src/index.ts";

/** A client whose sent lines are kept, and a way to answer them. */
function client() {
  const sent: { id: number; method: string }[] = [];
  const c = new RpcClient((line) => void sent.push(JSON.parse(line)));
  const answer = (result: unknown) => c.receive(JSON.stringify({ jsonrpc: "2.0", id: sent.at(-1)!.id, result }));
  return { c, sent, answer };
}

const HELLO: CoreHello = { protocol: 1, app: "source", pid: 1, socket: "/s", build: "b", methods: ["core.hello", "pane.list"] };

describe("RpcClient.hello", () => {
  it("knows nothing before the hello: every method is tried", () => {
    const { c, sent } = client();
    expect(c.has("remote.status")).toBe(true);
    void c.call("remote.status", {});
    expect(sent.map((m) => m.method)).toEqual(["remote.status"]);
  });

  it("refuses a method the core didn't list before writing anything", async () => {
    const { c, sent, answer } = client();
    const hello = c.hello();
    answer(HELLO);
    expect(await hello).toEqual(HELLO);
    expect(c.core).toEqual(HELLO);
    expect(c.has("pane.list")).toBe(true);
    expect(c.has("remote.status")).toBe(false);
    await expect(c.call("remote.status", {})).rejects.toMatchObject({ code: UNKNOWN_METHOD });
    expect(sent.map((m) => m.method)).toEqual(["core.hello"]);
  });

  it("tries everything with a core that doesn't list its methods", async () => {
    const { c, answer } = client();
    const hello = c.hello();
    answer({ pid: 1, socket: "/s", build: "b" });
    await hello;
    expect(c.has("remote.status")).toBe(true);
  });
});
