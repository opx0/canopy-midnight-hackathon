import express from "express";
import cors from "cors";
import path from "node:path";
import { bootstrap, connect, logger } from "./chain.js";
import { port, root } from "./config.js";
import routes from "./routes.js";
import { pruneSessions, seedShowcase } from "./demo.js";
import { keepSnapshotting, load } from "./history.js";
import { pruneJobs } from "./jobs.js";

const warmUp = {
  ready: false,
  reads: false,
  since: Date.now(),
  failure: undefined as string | undefined,
};

const app = express();
app.use(cors());
app.use(express.json());

app.get("/api/status", (_req, res) => {
  res.json({
    ready: warmUp.ready,
    reads: warmUp.reads,
    failure: warmUp.failure,
    warmingUpSeconds: Math.round((Date.now() - warmUp.since) / 1000),
  });
});

app.use("/api", (req, res, next) => {
  if (warmUp.ready || req.method === "GET") return next();
  res.status(503).json({
    error:
      warmUp.failure ??
      "Canopy's fee wallet is still waking up, so it cannot write to the chain yet. Everything on this page is live contract state and stays readable.",
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

connect()
  .then(async (deployed) => {
    warmUp.reads = deployed;
    await load();
    if (deployed) keepSnapshotting();
  })
  .catch((error: unknown) =>
    logger.warn({ error }, "could not reach the indexer for read-only state"),
  )
  .then(() =>
    bootstrap({ deployIfMissing: process.env.CANOPY_DEPLOY_IF_MISSING === "1" }),
  )
  .then(
    async ({ contractAddress }) => {
      warmUp.ready = true;
      warmUp.reads = true;
      logger.info({ contractAddress }, "Canopy is ready");
      keepSnapshotting();
      await seedShowcase();
    },
    (error: unknown) => {
      warmUp.failure = error instanceof Error ? error.message : String(error);
      logger.error({ error: warmUp.failure }, "Canopy could not start");
    },
  );
