import { applyDatabaseUrlFromEnv } from "./dbUrl.js";
import { createApp } from "./app.js";
import { config } from "./config.js";

applyDatabaseUrlFromEnv();

const app = createApp();
const server = app.listen(config.port, "0.0.0.0", () => {
  const prefix = config.basePath || "/";
  console.log(`Savills Cloud Portal listening on 0.0.0.0:${config.port} (base path ${prefix})`);
});
// Node's default requestTimeout is 300s, which cuts off a slow upload before
// DigitalOcean's ~600s window. Stock imports are batched so they finish in
// seconds; this only covers receiving a large workbook.
server.requestTimeout = 600_000;
server.timeout = 0;
