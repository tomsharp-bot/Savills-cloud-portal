import { applyDatabaseUrlFromEnv } from "./dbUrl.js";
import { createApp } from "./app.js";
import { config } from "./config.js";

applyDatabaseUrlFromEnv();

const app = createApp();
app.listen(config.port, "0.0.0.0", () => {
  const prefix = config.basePath || "/";
  console.log(`Savills Cloud Portal listening on 0.0.0.0:${config.port} (base path ${prefix})`);
});
