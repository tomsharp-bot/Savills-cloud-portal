import { applyDatabaseUrlFromEnv } from "./dbUrl.js";
import { createApp } from "./app.js";
import { config } from "./config.js";
import { logSpacesStartup } from "./lib/spaces.js";

applyDatabaseUrlFromEnv();
logSpacesStartup();

const app = createApp();
const server = app.listen(config.port, "0.0.0.0", () => {
  const prefix = config.basePath || "/";
  console.log(`Savills Cloud Portal listening on 0.0.0.0:${config.port} (base path ${prefix})`);
});
// Node's default requestTimeout is 300s, which cuts off a slow upload before
// DigitalOcean's ~600s window. Stock imports are batched and each batch commits,
// so a dropped request can be continued by uploading the same file again.
// Morning photo ingest uses the same window for a batch of about 20 JPEGs (~50 MB).
server.requestTimeout = 600_000;
server.headersTimeout = 610_000;
server.keepAliveTimeout = 610_000;
server.timeout = 0;
