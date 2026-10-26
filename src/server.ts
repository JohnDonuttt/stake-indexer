import { createServer, type Server } from "node:http";
import { isAddress } from "viem";
import { Store } from "./db.js";

function json(res: import("node:http").ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

export function createApi(store: Store): Server {
  return createServer((req, res) => {
    if (req.method !== "GET") return json(res, 405, { error: "method not allowed" });

    const url = new URL(req.url ?? "/", "http://localhost");
    const parts = url.pathname.split("/").filter(Boolean);

    try {
      if (parts.length === 0 || parts[0] === "health") {
        return json(res, 200, { ok: true, lastBlock: store.lastIndexedBlock()?.toString() ?? null });
      }

      if (parts[0] === "stats") return json(res, 200, store.totals());

      if (parts[0] === "stakers" && parts.length === 1) {
        const limit = Number(url.searchParams.get("limit") ?? 20);
        return json(res, 200, store.topStakers(Number.isFinite(limit) ? limit : 20));
      }

      if (parts[0] === "stakers" && parts[1]) {
        if (!isAddress(parts[1])) return json(res, 400, { error: "invalid address" });
        const row = store.staker(parts[1]);
        if (!row) return json(res, 404, { error: "unknown staker" });
        return json(res, 200, { ...row, events: store.recentEvents({ user: parts[1], limit: 50 }) });
      }

      if (parts[0] === "events") {
        const limit = Number(url.searchParams.get("limit") ?? 50);
        return json(res, 200, store.recentEvents({ limit: Number.isFinite(limit) ? limit : 50 }));
      }

      return json(res, 404, { error: "not found" });
    } catch (err) {
      console.error(err);
      return json(res, 500, { error: "internal error" });
    }
  });
}
