import { createPublicClient, http, isAddress } from "viem";
import { Store } from "./db.js";
import { run } from "./indexer.js";
import { createApi } from "./server.js";

function env(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) throw new Error(`missing env var ${name}`);
  return value;
}

const stakingAddress = env("STAKING_ADDRESS");
if (!isAddress(stakingAddress)) throw new Error("STAKING_ADDRESS is not a valid address");

const store = new Store(env("DB_PATH", "./indexer.db"));
const client = createPublicClient({ transport: http(env("RPC_URL", "http://127.0.0.1:8545")) });

const abort = new AbortController();
const server = createApi(store);
const port = Number(env("PORT", "3000"));

server.listen(port, () => console.log(`api listening on :${port}`));

run(
  {
    client,
    store,
    address: stakingAddress,
    startBlock: BigInt(env("START_BLOCK", "0")),
    confirmations: BigInt(env("CONFIRMATIONS", "2")),
    batchSize: 2000n,
  },
  Number(env("POLL_MS", "2000")),
  abort.signal,
);

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    abort.abort();
    server.close();
    store.close();
    process.exit(0);
  });
}
