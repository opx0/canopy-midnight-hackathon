# What we learned building on Midnight

Things that cost us hours and are not in the documentation, written down so they
cost somebody else minutes. Everything below was measured on Midnight **PreProd**
against ledger `8.0.2`, runtime `0.16.0`, compiler `0.31.1` and
`@midnight-ntwrk/testkit-js` `4.1.1`, between 17 and 20 August 2026.

Where we are inferring rather than measuring, it says so.

---

## 1. A ZK circuit's security lives in what it constrains, not what it passes in

`retireCredit` proves a credit was issued by checking a Merkle path returned
from a witness:

```compact
const commitment = creditCommitment(serial, tonnes, me, salt);
const path = creditPath(commitment);
assert(path.leaf == commitment, "the supplied path is not for this credit");
assert(
  creditTree.checkRoot(disclose(merkleTreePathRoot<10, Bytes<32>>(path))),
  "credit was never issued by the registry"
);
```

Without the middle line this circuit mints tonnage from nothing. A witness is
local code the *prover* controls; passing `commitment` into `creditPath`
constrains nothing about what comes back. A modified prover returns the
authentication path of somebody else's genuine credit, the root check passes
against the honest root, and a credit of any size is retired that was never
issued. We reproduced it: a claim of 1,000,000 tonnes against a registry that
had issued 600.

The more useful lesson was about the tests. Ours had been passing for the wrong
reason — they exercised fraud through the *honest* witness implementation, which
of course refuses to cheat. A fraud test that does not install a lying witness
proves nothing about the circuit.

## 2. Two things the compiler enforces that the docs do not spell out

- **Every exported circuit parameter is private until disclosed.** Not just
  witness results — parameters too. This is a good default and it will reject
  code you expected to compile.
- **`Set.member()` leaks exactly as much as `Set.insert()`**, because both are
  ledger operations. Reading a set inside a circuit is as public as writing to
  it.

Several drafts of this contract were rejected by the compiler for reaching
public state without `disclose()`, including one that wrote a Merkle root
computed from a private path straight to the ledger. Privacy here is a
compile-time property, not a code review convention.

## 3. Ordering around a reconstructed value is load-bearing

Canopy recovers a company's retired total by testing its own notes against the
public nullifier set, the way a shielded wallet recovers a balance. That means
`tallyTonnes()` must be read **before** `retiredCredits.insert(nullifier)`.
Reversed, the reconstruction counts the credit being retired right now and
doubles it. Nothing warns you; the tests do.

## 4. Nullifiers keyed to a serial break as soon as anything can be transferred

Our first nullifier was `hash("canopy:retire:", serial, ownerSecretKey)`. That
is sound while credits only ever go from issuance to retirement. Add a transfer
and it fails twice over:

- a serial outlives a transfer, so the seller's nullifier differs from the
  buyer's and the seller can retire a credit they already sold;
- binding the sender's key in to close that hole makes any credit that returns
  to a previous holder permanently unspendable, because its nullifier was burnt
  on the way out.

Keying the nullifier to the **commitment** fixes both. The commitment changes on
every hop, so every note has exactly one nullifier, for its whole life, in
exactly one pair of hands. This is the Zcash note model and there is a reason
for it.

---

## 5. `1010: Invalid Transaction: Custom error: 117` is a zero fee

This one cost days.

A contract deployed cleanly and then **every** contract call was rejected by the
node during ledger validation with an eight-bit error code and no text. The fee
wallet held 2.6 DUST and was synced to the tip.

Code 117 is `TransactionMalformed(NotNormalized)`. When `feesWithMargin`
evaluates to zero and no `additionalFeeOverhead` is set, the wallet emits an
empty `DustActions`, and `DustActions::well_formed` rejects it. **`testkit-js`
ships `DEFAULT_DUST_OPTIONS.additionalFeeOverhead` as `0n`.** A `ContractDeploy`
survives that; a contract call does not — which is exactly the shape of a system
that deploys once and then never works again.

```ts
WalletFactory.createDustWallet(config, seed, {
  ...DEFAULT_DUST_OPTIONS,
  additionalFeeOverhead: 10_000_000_000n, // anything positive the wallet can cover
});
```

Note that the restore path takes the default too, so setting it in one place is
not enough if your wallet is ever rebuilt from a serialised state.

**Two process lessons.** Midnight publishes the full code table in
[`midnightntwrk/midnight-expert`](https://github.com/midnightntwrk/midnight-expert);
reading it would have cost ten minutes and we spent days reasoning about the
number instead. And our own error reporting hid the evidence: midnight-js wraps
the node's answer in an Effect tagged error whose message is always the
invariant string `Transaction submission error`. Read the whole error graph and
decode the code, or every ledger rejection looks identical.

Codes we hit, for the search engines: **117** malformed / zero fee, **138**
balance check overspend, **170** invalid DUST spend proof, **171** out of DUST
validity window, **173** could not cover the DUST fee.

## 6. The DUST budget, in numbers

`LedgerParameters.initialParameters().dust` on PreProd:

| Parameter | Value | What it means |
| --- | --- | --- |
| `night_dust_ratio` | 5,000,000,000 | cap on DUST a registered NIGHT UTxO can hold |
| `time_to_cap` | 604,815 s | seven days from empty to that cap |
| `generation_decay_rate` | 8,267 | the per-second generation constant |
| `dust_grace_period` | 10,800 s | three hours before a DUST output leaves its validity window |

For one registered NIGHT UTxO of 1,000,000,000 that is a cap of 5×10¹⁸ and a
regeneration rate of **8.27×10¹² per second** — which is exactly the slope we
measured off the wallet over an idle eight minutes. The model is linear and the
numbers agree.

The consequence for anything always-on: **DUST, not proving and not the node, is
what caps your write rate.** Canopy proves and confirms a transaction in about
36 seconds; sizing the fee overhead at Midnight's template value of
`300_000_000_000_000n` means each transaction also needs about *thirty-six
seconds of regeneration* to be affordable. Those two numbers being similar is a
coincidence, and it is the coincidence that let an unpaced seeding script look
fine for thirteen transactions before it fell over.

## 7. The ledger charged 3×10¹⁴ and the wallet lost 2×10¹⁷

Two measurements that do not agree, and the disagreement is the interesting part.

The indexer reports `paidFees: "1"` — one SPECK — for every transaction this
contract has made. Deserialising the transaction itself shows what was actually
declared:

```
DustActions {
    DustSpend {
        v_fee: 300000000000001,
        old_nullifier: <dust nullifier>,
        new_commitment: <dust commitment>,
    registrations: [],
```

`300000000000001` is exactly `feesWithMargin` (1) plus the
`additionalFeeOverhead` we had set at the time (3×10¹⁴). So the ledger took
3×10¹⁴ per transaction and, note, produced a `new_commitment` — the change
output exists.

Over those same thirteen transactions the wallet's spendable balance went from
2.65×10¹⁸ to zero. That is 2×10¹⁷ per transaction, **680 times** what the
transaction declared, and it did not recover afterwards: the wallet sat fully
synced — `appliedIndex == highestRelevantWalletIndex`, `isConnected: true` —
reporting zero from a registered NIGHT UTxO for hours.

The chain is not the problem. A spend declares a modest fee and creates a
replacement output; what fails is the wallet's local account of that output.
Rebuilding the DUST state from genesis rather than restoring it from a
serialised snapshot is what we did about it.

Two practical consequences:

- **A cached wallet state is a cache, and it can be wrong.** It turns a
  multi-hour scan into ten seconds, which is worth having, but treat a balance
  it reports as evidence rather than fact — particularly a zero.
- **`additionalFeeOverhead` is a real cost, not a safety margin.** At Midnight's
  template value of 3×10¹⁴ each transaction needs about thirty-six seconds of
  regeneration from one registered NIGHT UTxO before it is affordable. We run
  1×10¹⁰, which is a millisecond of it, and the ledger has never asked for more
  than one SPECK on top.

`npm run inspect-tx --workspace @canopy/server -- <hash>` in this repo prints
the above for any transaction. It is thirty lines and it ended a day of
guessing.

## 8. A drained wallet does not recover on its own, and cannot re-register itself

After the balance hit zero it stayed there. The wallet was fully synced —
`appliedIndex == highestRelevantWalletIndex`, `isConnected: true` — and held one
NIGHT UTxO reporting `registeredForDustGeneration: true` while generating
nothing.

Re-registering it is the obvious move, and Midnight's own notes say registration
is self-funding because the fee comes from the NIGHT being registered rather
than from the balance. That holds for NIGHT that has *never* been registered.
Re-registering NIGHT that already is registered is an ordinary transaction, and
an ordinary transaction from a wallet at zero DUST comes back as node error
**138**. A wallet in this state cannot pay its way out of it.

What we would do differently: **register more than one NIGHT UTxO.** The cap and
the rate both scale with registered NIGHT, and a single UTxO gives you a single
point of failure for every write your application makes.

## 9. Operational notes for anything long-lived

- **The DUST scan starts at genesis and there is no checkpoint API.** On PreProd
  that is ~1.45 million ledger events; on a shared small VM we measured 57–199
  events per second, so two to seven hours. Serialise the wallet with
  `dust.serializeState()` and restore it on boot — that turns every later start
  into seconds. `server/src/scripts/restore-check.ts` in this repo proves the
  restored wallet resumes where the scan stopped rather than replaying.
- **Restoring blocks the event loop for minutes.** Deserialising a 10 MB wallet
  state is synchronous work inside the SDK; on our VM it held Node for 209
  seconds, during which the HTTP server accepted connections and answered none
  of them. If your app is a website, serve the static files from something that
  is not Node.
- **The indexer's block timestamp is the wallet's clock.**
  `balanceUnboundTransaction` has no `currentTime` option, so a lagging indexer
  makes the wallet build transactions with a stale `ctime`, and past the
  three-hour grace period every submission comes back as **171**. Check indexer
  tip against RPC tip before believing a "synced" wallet.
- **Contract identity and fee payer are separate.** This is the feature that
  lets a public demo need no wallet at all: contract identities come from a
  secret in private state, so one funded wallet on a server can act as registry,
  two companies and an auditor at once, and every visitor can be given their own
  derived keys.
- **Third-party PreProd explorers are not usable right now.** NightForge's
  indexer has been stuck at block 951,464 since May. Query
  `indexer.preprod.midnight.network` directly instead; it answers anonymously.
