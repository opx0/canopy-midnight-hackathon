import { readFile, writeFile } from "node:fs/promises";
import * as Rx from "rxjs";
import {
  DEFAULT_DUST_OPTIONS,
  FluentWalletBuilder,
  WalletFactory,
  WalletSeeds,
} from "@midnight-ntwrk/testkit-js";
import { DustWallet } from "@midnight-ntwrk/wallet-sdk-dust-wallet";
import { DustSecretKey } from "@midnight-ntwrk/ledger-v8";
import { setNetworkId } from "@midnight-ntwrk/midnight-js-network-id";
import { environment } from "../config.js";
import { walletSeed } from "../identities.js";

const file = "/tmp/canopy-restore-check.json";
const scanSeconds = Number(process.argv[2] ?? 90);

type Configuration = Parameters<typeof WalletFactory.createDustWallet>[0];

const configuration = (): Configuration => ({
  ...(
    FluentWalletBuilder.forEnvironment(environment) as unknown as {
      config: Configuration;
    }
  ).config,
  costParameters: {
    ledgerParams: DEFAULT_DUST_OPTIONS.ledgerParams,
    additionalFeeOverhead: DEFAULT_DUST_OPTIONS.additionalFeeOverhead,
    feeBlocksMargin: DEFAULT_DUST_OPTIONS.feeBlocksMargin,
  },
});

const appliedIndex = (wallet: {
  state: Rx.Observable<{ state: { progress: { appliedIndex: bigint } } }>;
}) =>
  Rx.firstValueFrom(
    wallet.state.pipe(Rx.map((s) => s.state.progress.appliedIndex)),
  );

setNetworkId(environment.walletNetworkId);
const seeds = WalletSeeds.fromMasterSeed(walletSeed);
const secretKey = DustSecretKey.fromSeed(seeds.dust);

const fresh = WalletFactory.createDustWallet(configuration(), seeds.dust);
await fresh.start(secretKey);
await new Promise((resolve) => setTimeout(resolve, scanSeconds * 1000));
const scanned = await appliedIndex(fresh);
await writeFile(file, await fresh.serializeState());
await fresh.stop();
console.log(`scanned to ${scanned}`);

const restored = DustWallet(configuration()).restore(await readFile(file, "utf8"));
await restored.start(secretKey);
const resumed = await appliedIndex(restored);
await restored.stop();
console.log(`restored at ${resumed}`);

if (resumed < scanned) {
  throw new Error(`restore lost progress: ${resumed} < ${scanned}`);
}
console.log("restore keeps the scan");
process.exit(0);
