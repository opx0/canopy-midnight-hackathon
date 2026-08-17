import express from "express";
import cors from "cors";
import path from "node:path";
import { bootstrap, logger } from "./chain.js";
import { port, root } from "./config.js";
import routes from "./routes.js";
import { pruneSessions } from "./demo.js";
import { pruneJobs } from "./jobs.js";

const warmUp = {
  ready: false,
  since: Date.now(),
  failure: undefined as string | undefined,
};

const app = express();
app.use(cors());
app.use(express.json());

app.get("/api/status", (_req, res) => {
  res.json({
    ready: warmUp.ready,
    failure: warmUp.failure,
    warmingUpSeconds: Math.round((Date.now() - warmUp.since) / 1000),
  });
});

app.use("/api", (_req, res, next) => {
  if (warmUp.ready) return next();
  res.status(503).json({
    error:
      warmUp.failure ??
      "Canopy is still scanning the chain for the DUST that pays transaction fees. This takes a few hours on a fresh start and only happens once per process.",
  });
});

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
  logger.info({ port }, "Canopy is serving, wallet still warming up");
});

bootstrap({ deployIfMissing: process.env.CANOPY_DEPLOY_IF_MISSING === "1" }).then(
  ({ contractAddress }) => {
    warmUp.ready = true;
    logger.info({ contractAddress }, "Canopy is ready");
  },
  (error: unknown) => {
    warmUp.failure = error instanceof Error ? error.message : String(error);
    logger.error({ error: warmUp.failure }, "Canopy could not start");
  },
);
