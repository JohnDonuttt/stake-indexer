import { createRequire } from "node:module";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";

// vite (used by vitest) can't resolve the node:sqlite builtin yet, so load it via require
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");

export type EventKind = "Staked" | "Withdrawn" | "RewardPaid" | "RewardAdded";

export interface IndexedEvent {
  blockNumber: bigint;
  logIndex: number;
  txHash: string;
  kind: EventKind;
  user: string | null; // RewardAdded has no user
  amount: bigint;
}

export interface StakerRow {
  address: string;
  staked: string;
  claimed: string;
}

// amounts are uint256, which doesn't fit in a SQLite integer, so they're stored as
// decimal strings and summed as bigint in JS.
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS events (
    block_number INTEGER NOT NULL,
    log_index    INTEGER NOT NULL,
    tx_hash      TEXT NOT NULL,
    kind         TEXT NOT NULL,
    user         TEXT,
    amount       TEXT NOT NULL,
    PRIMARY KEY (block_number, log_index)
  );
  CREATE INDEX IF NOT EXISTS events_user_idx ON events (user, block_number);

  CREATE TABLE IF NOT EXISTS stakers (
    address TEXT PRIMARY KEY,
    staked  TEXT NOT NULL DEFAULT '0',
    claimed TEXT NOT NULL DEFAULT '0'
  );

  CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`;

export class Store {
  private db: DatabaseSyncType;

  constructor(path = ":memory:") {
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec(SCHEMA);
  }

  lastIndexedBlock(): bigint | null {
    const row = this.db.prepare("SELECT value FROM meta WHERE key = 'last_block'").get() as
      | { value: string }
      | undefined;
    return row ? BigInt(row.value) : null;
  }

  /**
   * Write a batch of events and advance the cursor in one transaction, so a crash
   * mid-batch can't leave the cursor ahead of the data (or the other way round).
   * Replaying a block is safe: duplicate (block, log_index) rows are ignored.
   */
  applyBatch(events: IndexedEvent[], upToBlock: bigint): void {
    const insert = this.db.prepare(
      `INSERT OR IGNORE INTO events (block_number, log_index, tx_hash, kind, user, amount)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    const getStaker = this.db.prepare("SELECT staked, claimed FROM stakers WHERE address = ?");
    const putStaker = this.db.prepare(
      `INSERT INTO stakers (address, staked, claimed) VALUES (?, ?, ?)
       ON CONFLICT(address) DO UPDATE SET staked = excluded.staked, claimed = excluded.claimed`,
    );

    this.db.exec("BEGIN");
    try {
      for (const ev of events) {
        const res = insert.run(
          Number(ev.blockNumber),
          ev.logIndex,
          ev.txHash,
          ev.kind,
          ev.user,
          ev.amount.toString(),
        );
        // already seen this log, don't double count it
        if (res.changes === 0 || !ev.user) continue;

        const row = getStaker.get(ev.user) as { staked: string; claimed: string } | undefined;
        let staked = BigInt(row?.staked ?? "0");
        let claimed = BigInt(row?.claimed ?? "0");

        if (ev.kind === "Staked") staked += ev.amount;
        else if (ev.kind === "Withdrawn") staked -= ev.amount;
        else if (ev.kind === "RewardPaid") claimed += ev.amount;

        putStaker.run(ev.user, staked.toString(), claimed.toString());
      }

      this.db
        .prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('last_block', ?)")
        .run(upToBlock.toString());
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  topStakers(limit = 20): StakerRow[] {
    const rows = this.db.prepare("SELECT address, staked, claimed FROM stakers").all() as unknown as StakerRow[];
    // strings don't sort numerically, so sort as bigint here
    return rows
      .filter((r) => BigInt(r.staked) > 0n)
      .sort((a, b) => (BigInt(b.staked) > BigInt(a.staked) ? 1 : -1))
      .slice(0, limit);
  }

  staker(address: string): StakerRow | null {
    const row = this.db
      .prepare("SELECT address, staked, claimed FROM stakers WHERE address = ?")
      .get(address.toLowerCase());
    return (row as unknown as StakerRow) ?? null;
  }

  recentEvents(opts: { user?: string; limit?: number } = {}) {
    const limit = Math.min(opts.limit ?? 50, 200);
    const base = "SELECT block_number AS blockNumber, log_index AS logIndex, tx_hash AS txHash, kind, user, amount FROM events";
    if (opts.user) {
      return this.db
        .prepare(`${base} WHERE user = ? ORDER BY block_number DESC, log_index DESC LIMIT ?`)
        .all(opts.user.toLowerCase(), limit);
    }
    return this.db.prepare(`${base} ORDER BY block_number DESC, log_index DESC LIMIT ?`).all(limit);
  }

  totals(): { totalStaked: string; stakers: number; events: number } {
    const rows = this.db.prepare("SELECT staked FROM stakers").all() as unknown as { staked: string }[];
    const totalStaked = rows.reduce((sum, r) => sum + BigInt(r.staked), 0n);
    const events = this.db.prepare("SELECT COUNT(*) AS n FROM events").get() as { n: number };
    return {
      totalStaked: totalStaked.toString(),
      stakers: rows.filter((r) => BigInt(r.staked) > 0n).length,
      events: events.n,
    };
  }

  close() {
    this.db.close();
  }
}
