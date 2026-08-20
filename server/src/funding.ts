import * as Rx from "rxjs";
import { unshieldedToken } from "@midnight-ntwrk/midnight-js-protocol/ledger";
import type {
  WalletFacade,
  FacadeState,
} from "@midnight-ntwrk/wallet-sdk-facade";
import type { Logger } from "pino";
import { environment } from "./config.js";

type Keystore = {
  getPublicKey(): string;
  getBech32Address(): { asString(): string };
  signData(payload: Uint8Array): string;
};

const ESTIMATED_DEPTH = 1_450_000;

export const scan = {
  applied: 0,
  perSecond: 0,
  estimatedTotal: ESTIMATED_DEPTH,
  secondsLeft: 0,
};

const night = (state: FacadeState): bigint =>
  state.unshielded.balances[unshieldedToken().raw] ?? 0n;

const dust = (state: FacadeState): bigint => state.dust.balance(new Date());

// A registered NIGHT UTxO reporting zero DUST is the one failure mode that stops this
// deployment writing, and "balance is zero" says nothing about why. Print the wallet's
// own view of its generating outputs so the answer is data rather than a hypothesis.
const readable = (value: unknown): string =>
  JSON.stringify(
    value,
    (_key, inner: unknown) =>
      typeof inner === "bigint" ? inner.toString() : inner,
  ) ?? "undefined";

export const dustDetail = (state: FacadeState): Record<string, unknown> => {
  const dustState = (state.dust as unknown as { state?: Record<string, unknown> })
    .state;
  const collections = Object.fromEntries(
    Object.entries(dustState ?? {}).map(([key, value]) => [
      key,
      Array.isArray(value) ? `array(${value.length})` : readable(value).slice(0, 400),
    ]),
  );
  return { keys: Object.keys(dustState ?? {}), ...collections };
};

const until = (
  logger: Logger,
  wallet: WalletFacade,
  label: string,
  ready: (state: FacadeState) => boolean,
  timeoutMs: number,
): Promise<FacadeState> => {
  const startedAt = Date.now();
  return Rx.firstValueFrom(
    wallet.state().pipe(
      Rx.throttleTime(5_000, undefined, { leading: true, trailing: true }),
      Rx.tap((state: FacadeState) => {
        const seconds = Math.round((Date.now() - startedAt) / 1000);
        logger.info(
          {
            waitingFor: label,
            seconds,
            night: night(state).toString(),
            dust: dust(state).toString(),
          },
          "waiting on wallet",
        );
        if (seconds > 0 && seconds % 60 < 6 && dust(state) === 0n) {
          logger.info(dustDetail(state), "dust wallet internals while it reads zero");
        }
      }),
      Rx.filter(ready),
      Rx.timeout({
        each: timeoutMs,
        with: () =>
          Rx.throwError(
            () => new Error(`timed out waiting for ${label} after ${timeoutMs}ms`),
          ),
      }),
    ),
  );
};

export const fund = async (
  logger: Logger,
  wallet: WalletFacade,
  keystore: Keystore,
): Promise<{ night: bigint; dust: bigint }> => {
  const address = keystore.getBech32Address().asString();
  logger.info({ address }, "fee wallet address");

  let state = await Rx.firstValueFrom(wallet.state());

  if (night(state) === 0n) {
    logger.warn(
      { address, faucet: environment.faucet },
      "fee wallet holds no NIGHT — fund the address above at the faucet; this will continue by itself once it arrives",
    );
    state = await until(
      logger,
      wallet,
      "NIGHT to arrive",
      (current) => night(current) > 0n,
      3_600_000,
    );
  }
  logger.info({ night: night(state).toString() }, "NIGHT available");

  if (dust(state) === 0n) {
    const startedScanAt = Date.now();
    // Where the scan resumed from. A restored wallet starts partway through, and
    // dividing the total applied by the time since boot would claim a rate it never
    // achieved and an ETA that never arrives.
    let resumedAt: number | undefined;
    state = await Rx.firstValueFrom(
      wallet.state().pipe(
        Rx.throttleTime(10_000, undefined, { leading: true, trailing: true }),
        Rx.tap((current: FacadeState) => {
          const p = current.dust.state.progress;
          const elapsed = Math.max(1, (Date.now() - startedScanAt) / 1000);
          scan.applied = Number(p.appliedIndex);
          resumedAt ??= scan.applied;
          scan.perSecond = Math.round((scan.applied - resumedAt) / elapsed);
          scan.estimatedTotal = Math.max(
            ESTIMATED_DEPTH,
            Number(p.highestIndex),
            scan.applied,
          );
          scan.secondsLeft = scan.perSecond
            ? Math.round((scan.estimatedTotal - scan.applied) / scan.perSecond)
            : 0;
          logger.info(
            {
              seconds: Math.round((Date.now() - startedScanAt) / 1000),
              applied: p.appliedIndex.toString(),
              highest: p.highestIndex.toString(),
              connected: p.isConnected,
              dust: dust(current).toString(),
            },
            "dust wallet scanning",
          );
        }),
        Rx.filter(
          (current: FacadeState) =>
            dust(current) > 0n ||
            current.dust.state.progress.isCompleteWithin(64n),
        ),
        Rx.timeout({ each: 21_600_000 }),
      ),
    );

    const nightUtxos = (current: FacadeState) =>
      current.unshielded.availableCoins.filter(
        (coin) => coin.utxo.type === unshieldedToken().raw,
      );
    if (nightUtxos(state).length === 0) {
      state = await until(
        logger,
        wallet,
        "NIGHT UTXOs to appear",
        (current) => nightUtxos(current).length > 0,
        600_000,
      );
    }

    const unregistered = nightUtxos(state).filter(
      (coin) => coin.meta.registeredForDustGeneration === false,
    );
    logger.info(
      { total: nightUtxos(state).length, unregistered: unregistered.length },
      "NIGHT UTXOs available for DUST generation",
    );

    // A wallet that is fully synced, holds registered NIGHT, and still reports zero
    // DUST is not waiting for anything — its generation has stopped. Re-register
    // everything rather than wait out an hour that will not change. Registration is
    // paid for by the NIGHT being registered, not by the DUST balance, so this is the
    // one transaction that can still be made from a standing start of nothing.
    const stalled = dust(state) === 0n && unregistered.length === 0;
    const toRegister = stalled ? nightUtxos(state) : unregistered;
    if (toRegister.length > 0) {
      logger.info(
        { utxos: toRegister.length, stalled },
        stalled
          ? "DUST generation has stopped on registered NIGHT, re-registering it"
          : "registering NIGHT for DUST generation",
      );
      // Registering NIGHT that has never been registered is self-funding. Registering
      // NIGHT that already is registered is an ordinary transaction, and an ordinary
      // transaction from a wallet at zero DUST is rejected — Midnight node error 138.
      // Worth attempting either way, never worth failing startup over.
      try {
        const recipe = await wallet.registerNightUtxosForDustGeneration(
          toRegister,
          keystore.getPublicKey(),
          (payload: Uint8Array) => keystore.signData(payload),
        );
        const txId = await wallet.submitTransaction(
          await wallet.finalizeRecipe(recipe),
        );
        logger.info({ txId }, "DUST registration submitted");
      } catch (error) {
        logger.warn(
          { error, stalled },
          stalled
            ? "could not re-register NIGHT with no DUST to pay for it; this wallet needs fresh NIGHT from the faucet"
            : "could not register NIGHT for DUST generation",
        );
      }
    }
    // Do not block startup on this. If DUST has not appeared, reads still work, the
    // contract is still readable, and every write already waits for an affordable fee
    // and says so. Hanging the whole server on a balance is worse than starting
    // without one.
    state = await until(
      logger,
      wallet,
      "DUST to become spendable",
      (current) => dust(current) > 0n,
      300_000,
    ).catch(() => state);

    if (dust(state) === 0n) {
      logger.warn(
        { registered: nightUtxos(state).length, address },
        "starting with no spendable DUST — registered NIGHT is generating nothing, so writes will wait until it does",
      );
    }
  }

  logger.info(
    { night: night(state).toString(), dust: dust(state).toString() },
    "fee wallet ready",
  );
  return { night: night(state), dust: dust(state) };
};
