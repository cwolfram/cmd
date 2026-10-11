// What `cmd` exits with: by the code of the core's error (RPC_CODES), so a script can tell
// "not there" from "turned off" without reading the message; 1 for anything else.

import { RpcError, type RpcCode } from "@cmd/protocol";

const EXIT: Partial<Record<RpcCode, number>> = { invalidParams: 2, notFound: 3, unavailable: 4, denied: 5, unknownMethod: 6 };

export function exitCode(err: unknown): number {
  const kind = err instanceof RpcError ? err.kind : null;
  return (kind && EXIT[kind]) ?? 1;
}
