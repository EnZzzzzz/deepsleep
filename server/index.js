import { AgentPool } from "./agent-pool.js";
import { Router } from "./router.js";
import { createWsServer } from "./ws-server.js";

export async function startServer(port = 3000, registry) {
  const pool = new AgentPool({ registry });
  const router = new Router(pool);
  const server = createWsServer(router);

  server.on("close", () => {
    pool.shutdownAll().catch(() => {});
  });

  return new Promise((resolve, reject) => {
    server.listen(port, () => resolve(server));
    server.on("error", reject);
  });
}
