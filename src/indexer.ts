import { type PublicClient, type Log } from "viem";
import { stakingAbi } from "./abi.js";
import { type IndexedEvent, type EventKind, Store } from "./db.js";

export interface IndexerConfig {
  client: PublicClient;
  store: Store;
  address: `0x${string}`;
  startBlock: bigint;
  // only index blocks this many behind head, so shallow reorgs never touch our data
  confirmations: bigint;
  // max block range per eth_getLogs call; public RPCs usually cap this
  batchSize: bigint;
}

export function toIndexedEvent(log: Log<bigint, number, false, undefined, true, typeof stakingAbi>): IndexedEvent {
  const kind = log.eventName as EventKind;
  const args = log.args as Record<string, unknown>;

  return {
    blockNumber: log.blockNumber,
    logIndex: log.logIndex,
    txHash: log.transactionHash,
    kind,
    user: typeof args.user === "string" ? args.user.toLowerCase() : null,
    amount: (args.amount ?? args.reward) as bigint,
  };
}

/** Index everything between the cursor and (head - confirmations). Returns the new cursor. */
export async function syncOnce(cfg: IndexerConfig): Promise<bigint | null> {
  const head = await cfg.client.getBlockNumber();
  const safeHead = head - cfg.confirmations;
  const last = cfg.store.lastIndexedBlock();
  let from = last === null ? cfg.startBlock : last + 1n;

  if (safeHead < from) return last;

  while (from <= safeHead) {
    const to = from + cfg.batchSize - 1n < safeHead ? from + cfg.batchSize - 1n : safeHead;

    const logs = await cfg.client.getContractEvents({
      address: cfg.address,
      abi: stakingAbi,
      fromBlock: from,
      toBlock: to,
      strict: true,
    });

    cfg.store.applyBatch(logs.map(toIndexedEvent), to);
    from = to + 1n;
  }

  return safeHead;
}

export async function run(cfg: IndexerConfig, pollMs: number, signal: AbortSignal) {
  while (!signal.aborted) {
    try {
      await syncOnce(cfg);
    } catch (err) {
      // RPC hiccups are normal, log and try again on the next tick
      console.error("sync failed:", err instanceof Error ? err.message : err);
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
}
