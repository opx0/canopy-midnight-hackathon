import path from "node:path";
import { fileURLToPath } from "node:url";
import type { EnvironmentConfiguration } from "@midnight-ntwrk/testkit-js";

export const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

export const zkConfigPath = path.join(
  root,
  "contract",
  "src",
  "managed",
  "canopy",
);

export const deploymentFile = path.join(root, "server", "deployment.json");

export const proofServer =
  process.env.CANOPY_PROOF_SERVER ?? "http://127.0.0.1:6300";

const networks: Record<string, Omit<EnvironmentConfiguration, "proofServer">> = {
  preview: {
    walletNetworkId: "preview",
    networkId: "preview",
    indexer: "https://indexer.preview.midnight.network/api/v4/graphql",
    indexerWS: "wss://indexer.preview.midnight.network/api/v4/graphql/ws",
    node: "https://rpc.preview.midnight.network",
    nodeWS: "wss://rpc.preview.midnight.network",
    faucet: "https://midnight-tmnight-preview.nethermind.dev/",
  } as Omit<EnvironmentConfiguration, "proofServer">,
  local: {
    walletNetworkId: "undeployed",
    networkId: "undeployed",
    indexer: "http://127.0.0.1:8088/api/v4/graphql",
    indexerWS: "ws://127.0.0.1:8088/api/v4/graphql/ws",
    node: "http://127.0.0.1:9944",
    nodeWS: "ws://127.0.0.1:9944",
    faucet: "",
  } as Omit<EnvironmentConfiguration, "proofServer">,
  preprod: {
    walletNetworkId: "preprod",
    networkId: "preprod",
    indexer: "https://indexer.preprod.midnight.network/api/v4/graphql",
    indexerWS: "wss://indexer.preprod.midnight.network/api/v4/graphql/ws",
    node: "https://rpc.preprod.midnight.network",
    nodeWS: "wss://rpc.preprod.midnight.network",
    faucet: "https://midnight-tmnight-preprod.nethermind.dev/",
  } as Omit<EnvironmentConfiguration, "proofServer">,
};

export const networkName = process.env.CANOPY_NETWORK ?? "preprod";

export const walletStateFile = path.join(
  root,
  "server",
  `wallet-state.${networkName}.json`,
);

export const environment: EnvironmentConfiguration = {
  ...(networks[networkName] ?? networks.preprod),
  proofServer,
} as EnvironmentConfiguration;

export const masterSeed =
  process.env.CANOPY_SEED ??
  "0000000000000000000000000000000000000000000000000000000000000001";

export const port = Number(process.env.PORT ?? 3001);
