import { describe, it, expect, beforeEach } from "vitest";
import { Store, type IndexedEvent } from "../src/db.js";

const alice = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const bob = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

function ev(partial: Partial<IndexedEvent> & Pick<IndexedEvent, "kind" | "amount">): IndexedEvent {
  return {
    blockNumber: 1n,
    logIndex: 0,
    txHash: "0x" + "00".repeat(32),
    user: alice,
    ...partial,
  };
}

describe("Store", () => {
  let store: Store;

  beforeEach(() => {
    store = new Store();
  });

  it("starts with no cursor", () => {
    expect(store.lastIndexedBlock()).toBeNull();
  });

  it("tracks staked balance across stake and withdraw", () => {
    store.applyBatch(
      [
        ev({ kind: "Staked", amount: 100n, logIndex: 0 }),
        ev({ kind: "Staked", amount: 50n, logIndex: 1 }),
        ev({ kind: "Withdrawn", amount: 30n, logIndex: 2 }),
      ],
      1n,
    );

    expect(store.staker(alice)?.staked).toBe("120");
  });

  it("handles amounts larger than 2^64", () => {
    const big = 10n ** 30n;
    store.applyBatch([ev({ kind: "Staked", amount: big })], 1n);
    expect(store.staker(alice)?.staked).toBe(big.toString());
  });

  it("counts claimed rewards separately from stake", () => {
    store.applyBatch(
      [ev({ kind: "Staked", amount: 100n }), ev({ kind: "RewardPaid", amount: 7n, logIndex: 1 })],
      1n,
    );
    const row = store.staker(alice);
    expect(row?.staked).toBe("100");
    expect(row?.claimed).toBe("7");
  });

  it("ignores a replayed block instead of double counting", () => {
    const batch = [ev({ kind: "Staked", amount: 100n })];
    store.applyBatch(batch, 1n);
    store.applyBatch(batch, 1n);

    expect(store.staker(alice)?.staked).toBe("100");
    expect(store.totals().events).toBe(1);
  });

  it("advances the cursor", () => {
    store.applyBatch([], 42n);
    expect(store.lastIndexedBlock()).toBe(42n);
  });

  it("rolls back the whole batch if something throws", () => {
    // a null amount violates NOT NULL on the second event
    const bad = { ...ev({ kind: "Staked", amount: 1n, logIndex: 1 }), amount: null as unknown as bigint };
    expect(() => store.applyBatch([ev({ kind: "Staked", amount: 100n }), bad], 5n)).toThrow();

    expect(store.staker(alice)).toBeNull();
    expect(store.lastIndexedBlock()).toBeNull();
  });

  it("ranks stakers by balance and hides zero balances", () => {
    store.applyBatch(
      [
        ev({ kind: "Staked", amount: 5n, user: alice, logIndex: 0 }),
        ev({ kind: "Staked", amount: 500n, user: bob, logIndex: 1 }),
        ev({ kind: "Staked", amount: 9n, user: "0xcccccccccccccccccccccccccccccccccccccccc", logIndex: 2 }),
        ev({ kind: "Withdrawn", amount: 9n, user: "0xcccccccccccccccccccccccccccccccccccccccc", logIndex: 3 }),
      ],
      1n,
    );

    const top = store.topStakers();
    expect(top.map((r) => r.address)).toEqual([bob, alice]);
    expect(store.totals()).toMatchObject({ totalStaked: "505", stakers: 2 });
  });

  it("returns events newest first and filters by user", () => {
    store.applyBatch(
      [
        ev({ kind: "Staked", amount: 1n, user: alice, blockNumber: 1n }),
        ev({ kind: "Staked", amount: 2n, user: bob, blockNumber: 2n }),
        ev({ kind: "Withdrawn", amount: 1n, user: alice, blockNumber: 3n }),
      ],
      3n,
    );

    expect(store.recentEvents().map((e) => (e as { blockNumber: number }).blockNumber)).toEqual([3, 2, 1]);
    expect(store.recentEvents({ user: alice })).toHaveLength(2);
  });
});
