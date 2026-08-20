import { ledger } from "@canopy/contract";
import { WebSocket } from "ws";
import { setNetworkId } from "@midnight-ntwrk/midnight-js-network-id";
import { indexerPublicDataProvider } from "@midnight-ntwrk/midnight-js-indexer-public-data-provider";
import { environment, networkName } from "../config.js";

(globalThis as { WebSocket?: unknown }).WebSocket ??= WebSocket;

// Check the site against the chain without trusting the site. Reads the contract
// state from Midnight's public indexer, decodes it with the contract's own ledger(),
// and compares the result with what the deployment serves. Anyone can run this.
//
//   npm run verify-chain --workspace @canopy/server -- <contract address> [site url]

const address = process.argv[2];
const site = process.argv[3] ?? "https://canopy.opxz.dev";

if (!address) {
  console.error(
    "usage: npm run verify-chain --workspace @canopy/server -- <address> [site url]",
  );
  process.exit(1);
}

setNetworkId(environment.walletNetworkId);

const state = await indexerPublicDataProvider(
  environment.indexer,
  environment.indexerWS,
).queryContractState(address);

if (state === null) {
  console.error(`no contract at ${address} on ${networkName}`);
  process.exit(2);
}

const onChain = ledger(state.data);
const fromChain = {
  issuedCredits: Number(onChain.issuedCredits),
  issuedTonnes: onChain.issuedTonnes.toString(),
  retirementEvents: Number(onChain.retirementEvents),
  transferEvents: Number(onChain.transferEvents),
  batches: [...onChain.batches].length,
  companies: [...onChain.companies].length,
  claims: [...onChain.claims].length,
  retired: [...onChain.retiredCredits].length,
  transferred: [...onChain.transferredCredits].length,
};

const served = (await fetch(`${site}/api/chain`, {
  signal: AbortSignal.timeout(30_000),
}).then((response) => response.json())) as Record<string, never>;

const fromSite = {
  issuedCredits: served.issuedCredits,
  issuedTonnes: served.issuedTonnes,
  retirementEvents: served.retirementEvents,
  transferEvents: served.transferEvents,
  batches: (served.batches as unknown[]).length,
  companies: (served.companies as unknown[]).length,
  claims: (served.claims as unknown[]).length,
  retired: (served.retiredNullifiers as unknown[]).length,
  transferred: (served.transferredNullifiers as unknown[]).length,
};

console.log("decoded from Midnight's indexer:", JSON.stringify(fromChain, null, 2));
console.log(`served by ${site}:`, JSON.stringify(fromSite, null, 2));

const identical = JSON.stringify(fromChain) === JSON.stringify(fromSite);
console.log(
  identical
    ? "identical — the site adds nothing of its own"
    : "MISMATCH — the site is not showing what the chain says",
);
process.exit(identical ? 0 : 3);
