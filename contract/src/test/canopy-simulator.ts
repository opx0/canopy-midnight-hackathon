import {
  type CircuitContext,
  QueryContext,
  sampleContractAddress,
  createConstructorContext,
  CostModel,
} from "@midnight-ntwrk/midnight-js-protocol/compact-runtime";
import {
  Contract,
  type Ledger,
  ledger,
  pureCircuits,
} from "../managed/canopy/contract/index.js";
import {
  type CanopyPrivateState,
  type CreditNote,
  createCanopyPrivateState,
  witnesses,
} from "../witnesses.js";

type Circuits = Contract<CanopyPrivateState>["impureCircuits"];

type CircuitArgs<K extends keyof Circuits> = Circuits[K] extends (
  context: CircuitContext<CanopyPrivateState>,
  ...args: infer A
) => unknown
  ? A
  : never;

export class CanopySimulator {
  private readonly contract: Contract<CanopyPrivateState>;
  private context: CircuitContext<CanopyPrivateState>;

  constructor(registrySecretKey: Uint8Array, auditorSecretKey: Uint8Array) {
    this.contract = new Contract<CanopyPrivateState>({ ...witnesses });
    const {
      currentPrivateState,
      currentContractState,
      currentZswapLocalState,
    } = this.contract.initialState(
      createConstructorContext(
        createCanopyPrivateState(registrySecretKey),
        "0".repeat(64),
      ),
      pureCircuits.registryPublicKey(registrySecretKey),
      pureCircuits.auditorPublicKey(auditorSecretKey),
    );
    this.context = {
      currentPrivateState,
      currentZswapLocalState,
      costModel: CostModel.initialCostModel(),
      currentQueryContext: new QueryContext(
        currentContractState.data,
        sampleContractAddress(),
      ),
    };
  }

  call<K extends keyof Circuits>(circuit: K, ...args: CircuitArgs<K>): Ledger {
    const run = this.contract.impureCircuits[circuit] as (
      context: CircuitContext<CanopyPrivateState>,
      ...args: CircuitArgs<K>
    ) => { context: CircuitContext<CanopyPrivateState> };
    this.context = run(this.context, ...args).context;
    return this.ledger;
  }

  retireCredit({ serial, tonnes, salt }: CreditNote): Ledger {
    return this.call("retireCredit", serial, tonnes, salt);
  }

  as(secretKey: Uint8Array, credits: readonly CreditNote[] = []): this {
    this.context.currentPrivateState = createCanopyPrivateState(
      secretKey,
      credits,
    );
    return this;
  }

  withDishonestWitnesses(overrides: Partial<typeof witnesses>): this {
    Object.assign(this.contract.witnesses, overrides);
    return this;
  }

  get ledger(): Ledger {
    return ledger(this.context.currentQueryContext.state);
  }
}
