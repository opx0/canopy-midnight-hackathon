import { bootstrap, logger, rootCause } from "../chain.js";
import {
  attestClaim,
  chainView,
  createSession,
  hex,
  issueCredit,
  openBatch,
  publishClaim,
  registerCompany,
  retireCredit,
  sessionView,
} from "../demo.js";

const timed = async <T>(label: string, work: () => Promise<T>): Promise<T> => {
  const started = Date.now();
  const result = await work();
  logger.info({ seconds: ((Date.now() - started) / 1000).toFixed(1) }, label);
  return result;
};

const mustFail = async (
  label: string,
  expected: RegExp,
  work: () => Promise<unknown>,
) => {
  try {
    await work();
    throw new Error(`SECURITY FAILURE: ${label} was accepted`);
  } catch (error) {
    const message = rootCause(error);
    if (message.startsWith("SECURITY FAILURE")) throw error;
    if (!expected.test(message)) {
      throw new Error(
        `WRONG REJECTION: ${label} was refused, but with "${message}" rather than ${String(expected)}`,
      );
    }
    logger.info({ rejectedWith: message }, `correctly refused: ${label}`);
  }
};

await bootstrap();

const session = createSession();
logger.info({ session: session.id }, "smoke session created");

await timed("opened batch", () => openBatch(session));
await timed("issued 600t", () => issueCredit(session, "ecocorp", 600n));
await timed("issued 900t", () => issueCredit(session, "ecocorp", 900n));
await timed("registered EcoCorp", () => registerCompany(session, "ecocorp"));
await timed("registered FraudCorp", () => registerCompany(session, "fraudcorp"));

const [first, second] = session.companies.ecocorp.credits;
const serialOf = (index: number) =>
  hex(session.companies.ecocorp.credits[index].serial);

await timed("retired 600t", () =>
  retireCredit(session, "ecocorp", serialOf(0)),
);
await timed("retired 900t", () =>
  retireCredit(session, "ecocorp", serialOf(1)),
);

await mustFail(
  "retiring the same credit twice",
  /already been retired/,
  () => retireCredit(session, "ecocorp", serialOf(0)),
);
await mustFail(
  "FraudCorp retiring EcoCorp's credit",
  /no ownership proof can be constructed/,
  () => retireCredit(session, "fraudcorp", serialOf(0)),
);
await mustFail(
  "claiming more than was retired",
  /claimed more than was actually retired/,
  () => publishClaim(session, "ecocorp", 50_000n, "FY2026 Q3"),
);
await mustFail(
  "a company with no retirements claiming",
  /claimed more than was actually retired/,
  () => publishClaim(session, "fraudcorp", 100n, "FY2026 Q3"),
);

const claim = await timed("published claim of >=1000t", () =>
  publishClaim(session, "ecocorp", 1_000n, "FY2026 Q3"),
);
await timed("auditor attested", () => attestClaim(session, claim.claimId));

const view = await sessionView(session);
const chain = await chainView();
const eco = view.companies.find((company) => company.role === "ecocorp")!;

const problems: string[] = [];
if (eco.retiredTonnes !== "1500") {
  problems.push(`expected 1500t retired, saw ${eco.retiredTonnes}`);
}
if (!chain.claims.some((c) => c.id === claim.claimId && c.attested)) {
  problems.push("claim is missing or unattested on chain");
}
if (chain.retiredNullifiers.some((n) => n === hex(first.serial))) {
  problems.push("a nullifier leaked a credit serial");
}
if (!first || !second) problems.push("credits were not issued");

logger.info(
  {
    contractRetirements: chain.retirementEvents,
    ecocorpRetiredTonnes: eco.retiredTonnes,
    claims: chain.claims.length,
  },
  "final state",
);

if (problems.length) {
  logger.error({ problems }, "SMOKE TEST FAILED");
  process.exit(1);
}

logger.info("SMOKE TEST PASSED — every rejection and every success behaved");
process.exit(0);
