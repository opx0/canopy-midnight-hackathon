import { readFile, writeFile } from "node:fs/promises";
import * as Rx from "rxjs";
import { WalletFactory, WalletSeeds } from "@midnight-ntwrk/testkit-js";
import { DustWallet } from "@midnight-ntwrk/wallet-sdk-dust-wallet";
import { DustSecretKey } from "@midnight-ntwrk/ledger-v8";
import { setNetworkId } from "@midnight-ntwrk/midnight-js-network-id";
import { environment } from "../config.js";
import { walletSeed } from "../identities.js";
import { dustConfiguration } from "../wallet.js";

const file = "/tmp/canopy-restore-check.json";
const scanSeconds = Number(process.argv[2] ?? 90);

const appliedIndex = (wallet: {
  state: Rx.Observable<{ state: { progress: { appliedIndex: bigint } } }>;
}) =>
  Rx.firstValueFrom(
    wallet.state.pipe(Rx.map((s) => s.state.progress.appliedIndex)),
  );

setNetworkId(environment.walletNetworkId);
const seeds = WalletSeeds.fromMasterSeed(walletSeed);
const secretKey = DustSecretKey.fromSeed(seeds.dust);

const fresh = WalletFactory.createDustWallet(dustConfiguration(), seeds.dust);
await fresh.start(secretKey);
await new Promise((resolve) => setTimeout(resolve, scanSeconds * 1000));
const scanned = await appliedIndex(fresh);
await writeFile(file, await fresh.serializeState());
await fresh.stop();
console.log(`scanned to ${scanned}`);

const restored = DustWallet(dustConfiguration()).restore(
  await readFile(file, "utf8"),
);
await restored.start(secretKey);
const resumed = await appliedIndex(restored);
await restored.stop();
console.log(`restored at ${resumed}`);

if (resumed < scanned) {
  throw new Error(`restore lost progress: ${resumed} < ${scanned}`);
}
console.log("restore keeps the scan");
process.exit(0);
