import { type Ledger, pureCircuits } from "./managed/canopy/contract/index.js";
import { type WitnessContext } from "@midnight-ntwrk/midnight-js-protocol/compact-runtime";

export type CreditNote = {
  readonly serial: Uint8Array;
  readonly tonnes: bigint;
  readonly salt: Uint8Array;
  readonly batchId: Uint8Array;
};

export type CanopyPrivateState = {
  readonly secretKey: Uint8Array;
  readonly credits: readonly CreditNote[];
};

export const createCanopyPrivateState = (
  secretKey: Uint8Array,
  credits: readonly CreditNote[] = [],
): CanopyPrivateState => ({ secretKey, credits });

export const noteCommitment = (
  { serial, tonnes, salt }: CreditNote,
  secretKey: Uint8Array,
): Uint8Array =>
  pureCircuits.creditCommitment(
    serial,
    tonnes,
    pureCircuits.companyPublicKey(secretKey),
    salt,
  );

export const noteNullifier = (
  credit: CreditNote,
  secretKey: Uint8Array,
): Uint8Array =>
  pureCircuits.spendNullifier(noteCommitment(credit, secretKey), secretKey);

// The tally is recovered, not trusted: whatever this returns has to reopen the
// commitment already sitting in the ledger, or the circuit rejects it. Reading the
// retirement set is simply the cheapest way to recover it after a restart. Credits
// this company passed on land in transferredCredits instead, so they do not count.
const tonnesRetiredAccordingToNullifierSet = (
  ledger: Ledger,
  { credits, secretKey }: CanopyPrivateState,
): bigint =>
  credits.reduce(
    (total, credit) =>
      ledger.retiredCredits.member(noteNullifier(credit, secretKey))
        ? total + credit.tonnes
        : total,
    0n,
  );

export const witnesses = {
  secretKey: ({
    privateState,
  }: WitnessContext<Ledger, CanopyPrivateState>): [
    CanopyPrivateState,
    Uint8Array,
  ] => [privateState, privateState.secretKey],

  creditPath: (
    { ledger, privateState }: WitnessContext<Ledger, CanopyPrivateState>,
    commitment: Uint8Array,
  ): [CanopyPrivateState, ReturnType<Ledger["creditTree"]["pathForLeaf"]>] => {
    const path = ledger.creditTree.findPathForLeaf(commitment);
    if (path === undefined) {
      throw new Error(
        "no issued credit opens to your key with these details, so no ownership proof can be constructed",
      );
    }
    return [privateState, path];
  },

  tallyTonnes: ({
    ledger,
    privateState,
  }: WitnessContext<Ledger, CanopyPrivateState>): [
    CanopyPrivateState,
    bigint,
  ] => [
    privateState,
    tonnesRetiredAccordingToNullifierSet(ledger, privateState),
  ],
};
