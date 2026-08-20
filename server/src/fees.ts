import { dustNow, logger } from "./chain.js";
import { additionalFeeOverhead } from "./wallet.js";

// Midnight pays fees in DUST, which one registered NIGHT UTxO regenerates at a fixed
// rate. That rate — not proving, not the node — is what caps how fast this deployment
// can write, and running the wallet to zero mid-seed is how we found out. Everything
// here exists to hold submissions back until the fee is actually affordable, and to
// report the real numbers instead of guessing at them.

// What a transaction needs *available* is feesWithMargin plus the overhead — measured
// at 300000000000001 in a real DustSpend, of which all but one was the overhead. Only
// feesWithMargin is unknown, so start just above the overhead and let a genuine
// shortfall raise it. Deliberately not derived from how far the balance falls per
// transaction: that is far larger than what the transaction declares, it is the
// wallet's local accounting rather than the ledger's, and waiting for it would mean
// waiting hours to buy something that costs almost nothing. The ceiling is about
// twenty minutes of regeneration on one registered NIGHT UTxO — far enough to find the
// real figure, close enough that nobody is quietly waiting all afternoon.
const floor = additionalFeeOverhead * 2n;
const ceiling = 10_000_000_000_000_000n;

export const fees = {
  dust: "0",
  required: floor.toString(),
  perSecond: 0,
  waitedSeconds: 0,
  waitingSince: 0,
  transactions: 0,
  lastCost: "0",
};

let required = floor;
let sampled: { at: number; dust: bigint } | undefined;

export const observe = async (): Promise<void> => {
  const dust = await dustNow().catch(() => 0n);
  const at = Date.now();
  if (sampled && at > sampled.at && dust > sampled.dust) {
    const perSecond = Number(dust - sampled.dust) / ((at - sampled.at) / 1000);
    // Smooth it: the balance is read through an indexer that updates in steps.
    fees.perSecond = Math.round(
      fees.perSecond ? fees.perSecond * 0.7 + perSecond * 0.3 : perSecond,
    );
  }
  sampled = { at, dust };
  fees.dust = dust.toString();
  fees.required = required.toString();
};

export const keepObserving = (everyMs = 20_000): void => {
  const take = () => void observe();
  take();
  setInterval(take, everyMs).unref();
};

// Hold here until the wallet can pay. Returns how long it waited, which the caller
// reports so a visitor sees "waiting for the fee wallet" rather than a dead spinner.
export const affordable = async (timeoutMs = 900_000): Promise<number> => {
  const startedAt = Date.now();
  for (;;) {
    const dust = await dustNow().catch(() => 0n);
    fees.dust = dust.toString();
    if (dust >= required) {
      fees.waitingSince = 0;
      const waited = Math.round((Date.now() - startedAt) / 1000);
      fees.waitedSeconds = waited;
      return waited;
    }
    if (Date.now() - startedAt > timeoutMs) {
      logger.warn(
        { dust: dust.toString(), required: required.toString() },
        "giving up waiting for DUST and trying anyway",
      );
      fees.waitingSince = 0;
      return Math.round((Date.now() - startedAt) / 1000);
    }
    if (!fees.waitingSince) fees.waitingSince = startedAt;
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
};

// Recorded, not acted on. The balance falls by roughly 680 times what the transaction
// declares — see docs/what-we-learned.md — and this is the measurement that says so.
export const spent = (before: bigint, after: bigint): void => {
  if (after >= before) return;
  fees.transactions += 1;
  fees.lastCost = (before - after).toString();
};

// A shortfall means the estimate was too low. Raise it, bounded, so the next attempt
// waits long enough instead of failing the same way.
export const raiseRequirement = (): void => {
  required = required * 4n > ceiling ? ceiling : required * 4n;
  fees.required = required.toString();
  logger.warn({ required: required.toString() }, "raised the DUST the wallet waits for");
};

// And ease it back down when transactions are landing, or one bad afternoon leaves
// every visitor waiting twenty minutes for a fee that has cost almost nothing since.
export const easeRequirement = (): void => {
  if (required <= floor) return;
  required = required / 2n < floor ? floor : required / 2n;
  fees.required = required.toString();
};

export const secondsToAfford = (): number =>
  fees.perSecond > 0
    ? Math.max(0, Math.round((Number(required) - Number(fees.dust)) / fees.perSecond))
    : 0;
