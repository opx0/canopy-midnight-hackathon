import express from "express";
import cors from "cors";
import path from "node:path";
import { bootstrap, logger } from "./chain.js";
import { port, root } from "./config.js";
import routes from "./routes.js";
import { pruneSessions } from "./demo.js";
import { pruneJobs } from "./jobs.js";

const { contractAddress } = await bootstrap();

const app = express();
app.use(cors());
app.use(express.json());
app.use("/api", routes);

const web = path.join(root, "web", "dist");
app.use(express.static(web));
app.get(/^(?!\/api).*/, (_req, res) => {
  res.sendFile(path.join(web, "index.html"));
});

app.use(
  (
    error: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    logger.error({ error: error.message }, "request failed");
    res.status(400).json({ error: error.message });
  },
);

setInterval(() => {
  pruneSessions();
  pruneJobs();
}, 600_000).unref();

app.listen(port, () => {
  logger.info({ port, contractAddress }, "Canopy backend listening");
});
