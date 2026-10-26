import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { Store } from "../src/db.js";
import { createApi } from "../src/server.js";

const alice = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

describe("api", () => {
  let server: Server;
  let base: string;

  beforeAll(async () => {
    const store = new Store();
    store.applyBatch(
      [{ blockNumber: 1n, logIndex: 0, txHash: "0x01", kind: "Staked", user: alice, amount: 100n }],
      1n,
    );
    server = createApi(store).listen(0);
    await new Promise((r) => server.once("listening", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(() => {
    server.close();
  });

  it("reports health and cursor", async () => {
    const res = await fetch(`${base}/health`);
    expect(await res.json()).toEqual({ ok: true, lastBlock: "1" });
  });

  it("returns a staker with their events", async () => {
    const res = await fetch(`${base}/stakers/${alice}`);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.staked).toBe("100");
    expect(body.events).toHaveLength(1);
  });

  it("rejects a malformed address", async () => {
    const res = await fetch(`${base}/stakers/not-an-address`);
    expect(res.status).toBe(400);
  });

  it("404s for an unknown staker and unknown routes", async () => {
    const unknown = await fetch(`${base}/stakers/0xdddddddddddddddddddddddddddddddddddddddd`);
    expect(unknown.status).toBe(404);
    expect((await fetch(`${base}/nope`)).status).toBe(404);
  });

  it("only allows GET", async () => {
    const res = await fetch(`${base}/stats`, { method: "POST" });
    expect(res.status).toBe(405);
  });
});
