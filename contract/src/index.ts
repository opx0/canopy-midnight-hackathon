import { CompiledContract } from "@midnight-ntwrk/midnight-js-protocol/compact-js";

export * from "./managed/canopy/contract/index.js";
export * from "./witnesses.js";

import * as CompiledCanopyContract from "./managed/canopy/contract/index.js";
import * as Witnesses from "./witnesses.js";

export const CanopyCompiledContract = CompiledContract.make<
  CompiledCanopyContract.Contract<Witnesses.CanopyPrivateState>
>("Canopy", CompiledCanopyContract.Contract<Witnesses.CanopyPrivateState>).pipe(
  CompiledContract.withWitnesses(Witnesses.witnesses),
  CompiledContract.withCompiledFileAssets("./managed/canopy"),
);
