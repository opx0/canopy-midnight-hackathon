import { WebSocket } from "ws";
import {
  MidnightWalletProvider,
  initializeMidnightProviders,
  type ContractConfiguration,
} from "@midnight-ntwrk/testkit-js";
import { fund } from "./funding.js";
import { setNetworkId } from "@midnight-ntwrk/midnight-js-network-id";
import {
  deployContract,
  findDeployedContract,
} from "@midnight-ntwrk/midnight-js-contracts";
import { readFile, writeFile } from "node:fs/promises";
import { pino } from "pino";

import {
  CanopyCompiledContract,
  pureCircuits,
  type CanopyPrivateState,
  type CreditNote,
} from "@canopy/contract";
import {
  deploymentFile,
  environment,
  networkName,
  zkConfigPath,
} from "./config.js";
import {
  auditorSecretKey,
  registrySecretKey,
  walletSeed,
} from "./identities.js";

(globalThis as { WebSocket?: unknown }).WebSocket ??= WebSocket;

export const logger = pino({
  level: process.env.CANOPY_LOG_LEVEL ?? "info",
  transport: { target: "pino-pretty", options: { colorize: true } },
});

type CanopyCircuit =
  | "openBatch"
  | "issueCredit"
  | "registerCompany"
  | "retireCredit"
  | "publishClaim"
  | "attestClaim";

type Providers = ReturnType<
  typeof initializeMidnightProviders<CanopyCircuit, CanopyPrivateState>
>;

let providers: Providers;
let contractAddress: string;

let queue: Promise<unknown> = Promise.resolve();

export const enqueue = <T>(work: () => Promise<T>): Promise<T> => {
  const result = queue.then(work, work);
  queue = result.catch(() => undefined);
  return result;
};

const readDeployedAddress = async (): Promise<string | undefined> => {
  try {
    const saved = JSON.parse(await readFile(deploymentFile, "utf8")) as {
      network?: string;
      contractAddress?: string;
    };
    return saved.network === networkName ? saved.contractAddress : undefined;
  } catch {
    return undefined;
  }
};

export const bootstrap = async ({
  deployIfMissing = false,
}: { deployIfMissing?: boolean } = {}): Promise<{ contractAddress: string }> => {
  setNetworkId(environment.walletNetworkId);
  logger.info({ network: networkName }, "starting Canopy backend");

  const walletProvider = await MidnightWalletProvider.build(
    logger,
    environment,
    walletSeed,
  );
  await walletProvider.start(false);

  await fund(
    logger,
    walletProvider.wallet,
    walletProvider.unshieldedKeystore as Parameters<typeof fund>[2],
  );

  const contractConfiguration: ContractConfiguration = {
    privateStateStoreName: "canopy-private-state",
    zkConfigPath,
  };
  providers = initializeMidnightProviders<CanopyCircuit, CanopyPrivateState>(
    walletProvider,
    environment,
    contractConfiguration,
  );

  const existing = await readDeployedAddress();
  if (existing) {
    contractAddress = existing;
    logger.info({ contractAddress }, "using existing deployment");
  } else if (deployIfMissing) {
    contractAddress = await deploy();
  } else {
    throw new Error(
      `No Canopy deployment recorded for '${networkName}'. Run: npm run deploy-contract`,
    );
  }

  return { contractAddress };
};

const deploy = async (): Promise<string> => {
  logger.info("deploying Canopy contract");
  await providers.privateStateProvider.set("canopy-deployer", {
    secretKey: registrySecretKey,
    credits: [],
  });
  const deployed = await deployContract(providers, {
    compiledContract: CanopyCompiledContract,
    privateStateId: "canopy-deployer",
    initialPrivateState: { secretKey: registrySecretKey, credits: [] },
    args: [
      pureCircuits.registryPublicKey(registrySecretKey),
      pureCircuits.auditorPublicKey(auditorSecretKey),
    ],
  });
  const address = deployed.deployTxData.public.contractAddress;
  await writeFile(
    deploymentFile,
    `${JSON.stringify({ network: networkName, contractAddress: address, deployedAt: new Date().toISOString() }, null, 2)}\n`,
  );
  logger.info({ contractAddress: address }, "contract deployed");
  return address;
};

export const handleFor = async (
  privateStateId: string,
  secretKey: Uint8Array,
  credits: readonly CreditNote[],
) => {
  const state: CanopyPrivateState = { secretKey, credits };
  await providers.privateStateProvider.set(privateStateId, state);
  return findDeployedContract(providers, {
    contractAddress,
    compiledContract: CanopyCompiledContract,
    privateStateId,
    initialPrivateState: state,
  });
};

export const publicLedger = async () => {
  const state = await providers.publicDataProvider.queryContractState(
    contractAddress,
  );
  if (state === null) {
    throw new Error("contract state unavailable");
  }
  const { ledger } = await import("@canopy/contract");
  return ledger(state.data);
};

export const getContractAddress = () => contractAddress;
