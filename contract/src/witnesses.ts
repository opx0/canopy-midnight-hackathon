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

const tonnesRetiredAccordingToNullifierSet = (
  ledger: Ledger,
  { credits, secretKey }: CanopyPrivateState,
): bigint =>
  credits.reduce(
    (total, credit) =>
      ledger.retiredCredits.member(
        pureCircuits.retirementNullifier(credit.serial, secretKey),
      )
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
