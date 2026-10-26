# stake-indexer

A small event indexer and HTTP API for the [`staking-rewards`](https://github.com/JohnDonuttt/staking-rewards) contract. It reads `Staked`, `Withdrawn`, `RewardPaid` and `RewardAdded` logs over JSON-RPC, keeps per-staker balances in SQLite, and serves them as JSON.

Reading balances straight from the chain works fine for one address, but "who are the top stakers?" or "show me this wallet's history" needs an index. This is the minimal version of that.

TypeScript, [viem](https://viem.sh), and Node's built-in `node:sqlite`. There is no web framework or ORM, and the HTTP layer is plain `node:http`.

## Run it

Needs Node 22.13+.

```sh
pnpm install
cp .env.example .env   # set RPC_URL and STAKING_ADDRESS
pnpm start
```

| Variable | Default | Meaning |
| --- | --- | --- |
| `RPC_URL` | `http://127.0.0.1:8545` | JSON-RPC endpoint |
| `STAKING_ADDRESS` | required | Deployed `StakingRewards` address |
| `START_BLOCK` | `0` | First block to scan. Set this to the deploy block on a real chain |
| `CONFIRMATIONS` | `2` | Only index blocks this far behind head |
| `POLL_MS` | `2000` | Poll interval |
| `DB_PATH` | `./indexer.db` | SQLite file |
| `PORT` | `3000` | API port |

## API

| Route | Returns |
| --- | --- |
| `GET /health` | `{ ok, lastBlock }` |
| `GET /stats` | Total staked, number of active stakers, event count |
| `GET /stakers?limit=20` | Stakers with a non-zero balance, largest first |
| `GET /stakers/:address` | Balance, total claimed, and that address's recent events |
| `GET /events?limit=50` | Latest events across all users (max 200) |

All amounts are strings in wei, since uint256 doesn't fit in a JS number.

## How it works

- **Cursor + data in one transaction.** `Store.applyBatch` writes the events, updates balances, and advances `last_block` in a single SQLite transaction. A crash can't leave the cursor ahead of the data.
- **Idempotent replays.** Events are keyed on `(block_number, log_index)` and inserted with `INSERT OR IGNORE`. Re-processing a block is a no-op, so balances are never double counted.
- **Big numbers.** Amounts are stored as decimal strings and summed as `bigint`, because SQLite integers are 64-bit and token amounts are 256-bit.
- **Batching.** `eth_getLogs` is called in ranges of 2000 blocks, since most hosted RPCs reject larger ranges.
- **Confirmations.** Only blocks at least `CONFIRMATIONS` behind head are indexed.

## Testing

```sh
pnpm test
```

14 tests cover the store (balance math, 10^30-sized amounts, replay safety, transaction rollback, ranking) and the API (routes, validation, status codes).

I also ran it end to end against a local anvil node with the real contract deployed. Two wallets staked, one withdrew, one claimed. The indexed balances and totals matched the on-chain state.

## Limitations

- **No reorg rollback.** Confirmations make deep reorgs unlikely to matter, but a reorg deeper than `CONFIRMATIONS` would leave stale rows. A proper fix stores block hashes and rewinds on mismatch.
- **Polling, not subscriptions.** Simple and works with any RPC, at the cost of up to `POLL_MS` latency.
- **`node:sqlite` is experimental** in Node 22 and prints a warning on startup.
- **Single contract, no auth, no rate limiting** on the API.
- `topStakers` sorts in JS rather than SQL. That is fine for thousands of stakers, but a numeric column or separate high/low columns would be better at scale.

## License

MIT
