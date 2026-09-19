import { createApp } from "./app.js";
import { config } from "./config.js";

const app = createApp();
app.listen(config.port, "0.0.0.0", () => {
  console.log(`Savills Cloud Portal listening on 0.0.0.0:${config.port}`);
});
