import { describe, expect, it } from "vitest";
import { CanopySimulator } from "./canopy-simulator.js";
import { randomBytes } from "./utils.js";
import { pureCircuits } from "../managed/canopy/contract/index.js";
import type { CreditNote } from "../witnesses.js";

const REGISTRY = randomBytes(32);
const AUDITOR = randomBytes(32);
const ECOCORP = randomBytes(32);
const FRAUDCORP = randomBytes(32);

const BATCH = randomBytes(32);

const note = (tonnes: bigint): CreditNote => ({
  serial: randomBytes(32),
  tonnes,
  salt: randomBytes(32),
  batchId: BATCH,
});

const commitmentFor = (credit: CreditNote, ownerSecretKey: Uint8Array) =>
  pureCircuits.creditCommitment(
    credit.serial,
    credit.tonnes,
    pureCircuits.companyPublicKey(ownerSecretKey),
    credit.salt,
  );

const registryHavingIssued = (
  credits: readonly CreditNote[],
  ownerKey: Uint8Array,
) => {
  const sim = new CanopySimulator(REGISTRY, AUDITOR);
  sim.as(REGISTRY);
  sim.call(
    "openBatch",
    BATCH,
    "Kariba REDD+ Forest Protection",
    2024n,
    50_000n,
    500n,
  );
  for (const credit of credits) {
    sim.call("issueCredit", BATCH, commitmentFor(credit, ownerKey));
  }
  return sim;
};

describe("canopy", () => {
  it("publishes batch supply but never who holds a credit", () => {
    const credits = [note(600n), note(900n)];
    const sim = registryHavingIssued(credits, ECOCORP);

    const batch = sim.ledger.batches.lookup(BATCH);
    expect(batch.project).toBe("Kariba REDD+ Forest Protection");
    expect(batch.tonnes).toBe(50_000n);
    expect(sim.ledger.issuedCredits).toBe(2n);

    const ecocorp = pureCircuits.companyPublicKey(ECOCORP);
    expect(sim.ledger.companies.member(ecocorp)).toBe(false);
  });

  it("retires a credit without disclosing the amount, reading the tally before nullifying so it cannot double-count, and blocks a second retirement", () => {
    const credit = note(600n);
    const sim = registryHavingIssued([credit], ECOCORP);

    sim.as(ECOCORP, [credit]);
    sim.call("registerCompany", "EcoCorp");
    sim.retireCredit(credit);

    expect(sim.ledger.retiredCredits.size()).toBe(1n);
    expect(sim.ledger.retirementEvents).toBe(1n);

    const ecocorp = pureCircuits.companyPublicKey(ECOCORP);
    const tally = sim.ledger.companies.lookup(ecocorp);
    expect(tally).toStrictEqual(pureCircuits.tallyCommitment(ECOCORP, 600n));
    expect(tally).not.toStrictEqual(
      pureCircuits.tallyCommitment(FRAUDCORP, 600n),
    );
    for (const nullifier of sim.ledger.retiredCredits) {
      expect(nullifier).not.toStrictEqual(credit.serial);
    }

    expect(() => sim.retireCredit(credit)).toThrow(/already been retired/);
    expect(sim.ledger.retiredCredits.size()).toBe(1n);
  });

  it("refuses to retire a credit the caller does not own", () => {
    const credit = note(600n);
    const sim = registryHavingIssued([credit], ECOCORP);

    sim.as(FRAUDCORP, [credit]);
    sim.call("registerCompany", "FraudCorp");
    expect(() => sim.retireCredit(credit)).toThrow(
      /no issued credit opens to your key/,
    );
    expect(sim.ledger.retiredCredits.size()).toBe(0n);
  });

  it("refuses to retire a credit the registry never issued", () => {
    const real = note(600n);
    const forged = note(10_000n);
    const sim = registryHavingIssued([real], ECOCORP);

    sim.as(ECOCORP, [real, forged]);
    sim.call("registerCompany", "EcoCorp");
    expect(() => sim.retireCredit(forged)).toThrow(
      /no issued credit opens to your key/,
    );
  });

  it("proves a claim it can cover and rejects one it cannot", () => {
    const credits = [note(600n), note(900n)];
    const sim = registryHavingIssued(credits, ECOCORP);

    sim.as(ECOCORP, credits);
    sim.call("registerCompany", "EcoCorp");
    sim.retireCredit(credits[0]);
    sim.retireCredit(credits[1]);

    const claimId = randomBytes(32);
    sim.call("publishClaim", claimId, 1_000n, "FY2026 Q3");

    const claim = sim.ledger.claims.lookup(claimId);
    expect(claim.threshold).toBe(1_000n);
    expect(claim.attested).toBe(false);
    expect(claim.company).toStrictEqual(pureCircuits.companyPublicKey(ECOCORP));

    expect(sim.ledger.companies.lookup(claim.company)).toStrictEqual(
      pureCircuits.tallyCommitment(ECOCORP, 1_500n),
    );

    expect(() =>
      sim.call("publishClaim", randomBytes(32), 5_000n, "FY2026 Q3"),
    ).toThrow(/claimed more than was actually retired/);
  });

  it("lets a company with no retirements claim nothing at all", () => {
    const credit = note(600n);
    const sim = registryHavingIssued([credit], ECOCORP);

    sim.as(FRAUDCORP);
    sim.call("registerCompany", "FraudCorp");
    expect(() =>
      sim.call("publishClaim", randomBytes(32), 1_000n, "FY2026 Q3"),
    ).toThrow(/claimed more than was actually retired/);
    expect(sim.ledger.claims.isEmpty()).toBe(true);
  });

  it("only the accredited auditor can attest, and attesting changes nothing else", () => {
    const credit = note(600n);
    const sim = registryHavingIssued([credit], ECOCORP);

    sim.as(ECOCORP, [credit]);
    sim.call("registerCompany", "EcoCorp");
    sim.retireCredit(credit);
    const claimId = randomBytes(32);
    sim.call("publishClaim", claimId, 500n, "FY2026 Q3");

    sim.as(FRAUDCORP);
    expect(() => sim.call("attestClaim", claimId)).toThrow(
      /not the accredited auditor/,
    );
    expect(sim.ledger.claims.lookup(claimId).attested).toBe(false);

    sim.as(AUDITOR);
    sim.call("attestClaim", claimId);
    const attested = sim.ledger.claims.lookup(claimId);
    expect(attested.attested).toBe(true);
    expect(attested.threshold).toBe(500n);
    expect(attested.period).toBe("FY2026 Q3");
  });

  it("refuses a prover-supplied Merkle path that authenticates a different credit, which would otherwise mint tonnage from nothing", () => {
    const real = note(600n);
    const sim = registryHavingIssued([real], ECOCORP);
    const realCommitment = commitmentFor(real, ECOCORP);

    const forged = note(1_000_000n);
    sim.as(FRAUDCORP, [forged]);
    sim.call("registerCompany", "FraudCorp");
    sim.withDishonestWitnesses({
      creditPath: ({ ledger, privateState }) => [
        privateState,
        ledger.creditTree.findPathForLeaf(realCommitment)!,
      ],
    });

    expect(() => sim.retireCredit(forged)).toThrow(
      /path is not for this credit/,
    );
    expect(sim.ledger.retiredCredits.size()).toBe(0n);
  });

  it("only the registry can issue supply", () => {
    const sim = new CanopySimulator(REGISTRY, AUDITOR);
    sim.as(FRAUDCORP);
    expect(() =>
      sim.call("openBatch", BATCH, "Ghost Project", 2024n, 1_000_000n, 1n),
    ).toThrow(/not the registry/);
  });

  it("keeps two companies' tallies independent and mutually opaque", () => {
    const mine = note(600n);
    const theirs = note(900n);
    const sim = registryHavingIssued([mine], ECOCORP);
    sim
      .as(REGISTRY)
      .call("issueCredit", BATCH, commitmentFor(theirs, FRAUDCORP));

    sim.as(ECOCORP, [mine]);
    sim.call("registerCompany", "EcoCorp");
    sim.retireCredit(mine);

    sim.as(FRAUDCORP, [theirs]);
    sim.call("registerCompany", "OtherCorp");
    sim.retireCredit(theirs);

    expect(
      sim.ledger.companies.lookup(pureCircuits.companyPublicKey(ECOCORP)),
    ).toStrictEqual(pureCircuits.tallyCommitment(ECOCORP, 600n));
    expect(
      sim.ledger.companies.lookup(pureCircuits.companyPublicKey(FRAUDCORP)),
    ).toStrictEqual(pureCircuits.tallyCommitment(FRAUDCORP, 900n));
    expect(sim.ledger.retiredCredits.size()).toBe(2n);
  });
});
