import { app } from "./app";
import { config } from "./config";
import { migrate } from "./db";
import { startWorker } from "./jobs/worker";

migrate();
startWorker();

Bun.serve({
  port: config.port,
  fetch: app.fetch,
});

console.log(`Event booking API listening on ${config.appUrl}`);
