import { Router } from "express";
import { getContractAddress, publicLedger } from "./chain.js";
import { networkName } from "./config.js";
import {
  allocation,
  attestClaim,
  chainView,
  createSession,
  disclosureFor,
  getSession,
  issueCredit,
  openBatch,
  projects,
  publishClaim,
  registerCompany,
  retireCredit,
  seedSession,
  sessionView,
  transferCredit,
  type Session,
} from "./demo.js";
import { getJob, start } from "./jobs.js";
import { historyView } from "./history.js";
import { benchmarks } from "./benchmarks.js";
import type { CompanyRole } from "./identities.js";

const router: Router = Router();

const role = (value: unknown): CompanyRole =>
  value === "fraudcorp" ? "fraudcorp" : "ecocorp";

router.get("/meta", (_req, res) => {
  res.json({
    network: networkName,
    contractAddress: getContractAddress(),
    projects: projects.map((entry) => ({
      key: entry.key,
      name: entry.name,
      vintage: Number(entry.vintage),
      tonnes: entry.tonnes.toString(),
      credits: Number(entry.credits),
    })),
    allocation: allocation.map(String),
  });
});

router.post("/session", (_req, res) => {
  const session = createSession();
  void seedSession(session);
  res.json({ id: session.id });
});

const withSession = (
  id: string,
  handler: (session: Session) => Promise<unknown>,
) => handler(getSession(id));

router.get("/session/:id", async (req, res, next) => {
  try {
    res.json(await withSession(req.params.id, sessionView));
  } catch (error) {
    next(error);
  }
});

router.get("/history", (_req, res) => {
  res.json(historyView());
});

router.get("/benchmarks", async (_req, res, next) => {
  try {
    res.json(await benchmarks());
  } catch (error) {
    next(error);
  }
});

// A claim is the artefact a regulator or a customer would actually be shown, so it
// gets its own address on the web as well as on the chain.
router.get("/claim/:id", async (req, res, next) => {
  try {
    const ledger = await publicLedger();
    const id = Uint8Array.from(Buffer.from(req.params.id, "hex"));
    const found = id.length === 32 && ledger.claims.member(id);
    const claim = found ? ledger.claims.lookup(id) : undefined;
    res.json({
      network: networkName,
      contractAddress: getContractAddress(),
      found,
      claim: claim && {
        id: req.params.id,
        company: Buffer.from(claim.company).toString("hex"),
        threshold: claim.threshold.toString(),
        period: claim.period,
        attested: claim.attested,
      },
      auditorKey: Buffer.from(ledger.auditorKey).toString("hex"),
      registryKey: Buffer.from(ledger.registryKey).toString("hex"),
      retirementEvents: Number(ledger.retirementEvents),
      checkedAt: Date.now(),
    });
  } catch (error) {
    next(error);
  }
});

router.get("/chain", async (_req, res, next) => {
  try {
    res.json(await chainView());
  } catch (error) {
    next(error);
  }
});

router.get("/session/:id/disclosure/:role", async (req, res, next) => {
  try {
    const session = getSession(req.params.id);
    res.json(await disclosureFor(session, role(req.params.role)));
  } catch (error) {
    next(error);
  }
});

router.post("/session/:id/action", (req, res, next) => {
  try {
    const session = getSession(req.params.id);
    const { action } = req.body as { action?: string };
    const body = req.body as Record<string, unknown>;

    const actions: Record<string, () => Promise<unknown>> = {
      "open-batch": () => openBatch(session, String(body.project ?? "")),
      issue: () =>
        issueCredit(
          session,
          role(body.role),
          BigInt(String(body.tonnes ?? 100)),
          String(body.project ?? ""),
        ),
      register: () => registerCompany(session, role(body.role)),
      retire: () =>
        retireCredit(session, role(body.role), String(body.serial ?? "")),
      transfer: () =>
        transferCredit(
          session,
          role(body.role),
          role(body.to),
          String(body.serial ?? ""),
        ),
      claim: () =>
        publishClaim(
          session,
          role(body.role),
          BigInt(String(body.threshold ?? 0)),
          String(body.period ?? "FY2026 Q3"),
        ),
      attest: () => attestClaim(session, String(body.claimId ?? "")),
    };

    const run = actions[action ?? ""];
    if (!run) {
      res.status(400).json({ error: `unknown action '${action ?? ""}'` });
      return;
    }
    res.json(start(action ?? "", run));
  } catch (error) {
    next(error);
  }
});

router.get("/job/:id", (req, res) => {
  const job = getJob(req.params.id);
  if (!job) {
    res.status(404).json({ error: "unknown job" });
    return;
  }
  res.json(job);
});

export default router;
