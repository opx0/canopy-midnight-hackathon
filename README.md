# Canopy

**Carbon claims you can verify. Books you cannot read.**

| | |
| --- | --- |
| **Live demo** | **https://canopy.opxz.dev** — no wallet, no extension, no signup |
| **Network** | Midnight **PreProd** |
| **Contract address** | `52a90ef413f1a794a2304ba0df65c60caa06c063e93a68511975d91b50968c5d` |
| **Deployed** | 2026-08-20T14:51:51Z |

Everything on the live site is a real transaction against that address. The
figures at the top of the page — transaction count, median prove-and-confirm
time, tonnes issued, retirements, trades, refused frauds — are measured, not
written by hand. So is everything under **What it costs**: ZK operation counts
and proving-key sizes are read from the compiled artefacts, and the latencies
come from transactions this deployment actually landed.

An earlier build ran at
`85aa0f8839a9771906dbab16612024a56b070b2679088e61442cb1bfd8eda709` until the
credit-transfer circuit forced a redeploy on 2026-08-20; `server/deployments.jsonl`
keeps the full list.

Canopy is a carbon credit registry on [Midnight](https://midnight.network) where
retiring a credit is publicly, permanently unrepeatable — and where nothing
about a company's offset volumes ever reaches the chain.

A company can prove *"in FY2026 Q3 we retired at least 1,000 tonnes"* without
revealing the real figure, which credits it used, or what it still holds. An
accredited auditor can be shown everything. Everyone else sees a hash.

### Check it without trusting this repository

Midnight's public indexer answers anonymously, so the contract's state can be
read straight from the network:

```bash
curl https://indexer.preprod.midnight.network/api/v4/graphql \
  -H 'content-type: application/json' \
  -d '{"query":"query($a:HexEncoded!){contractAction(address:$a){state}}",
       "variables":{"a":"52a90ef413f1a794a2304ba0df65c60caa06c063e93a68511975d91b50968c5d"}}'
```

What comes back is the serialised contract state; `ledger()` from
`@canopy/contract` decodes it into the counters, commitments, nullifiers and
claims the site displays. This repo will do that for you and diff the result
against what the live site serves:

```bash
npm run verify-chain --workspace @canopy/server -- \
  52a90ef413f1a794a2304ba0df65c60caa06c063e93a68511975d91b50968c5d
# → identical — the site adds nothing of its own
```
 No third-party PreProd explorer is indexing recent
blocks at the time of writing — NightForge's is months behind — so this is the
honest way to verify.

---

## The problem

In 2022 the crypto industry tried to fix carbon markets. Toucan bridged roughly
22 million Verra-registered credits onto a public chain. Verra responded by
[banning tokenisation outright](https://carboncredits.com/verra-suspension-carbon-credits-proposes-immobilizing-credits/).

The failure was architectural, not ideological. On a transparent-by-default
ledger:

- every company's offset position — and therefore its emissions profile — is
  public to its competitors;
- a registry has no cryptographic way to stop a retired credit from continuing
  to trade;
- "double counting" is something you detect afterwards by reading records,
  rather than something the system makes impossible.

Meanwhile the compliance pressure has only increased. From **September 2026**
the EU Green Claims Directive makes unsubstantiated offset-based "climate
neutral" claims illegal across the EU, prohibits self-certification, and
requires verification by an accredited body with no financial interest in the
outcome. CSRD/ESRS E1 names avoidance of double counting as a reporting
integrity requirement.

So the market needs two things that normally contradict each other:

| Public | Private |
| --- | --- |
| Proof a credit was retired exactly once | How many tonnes a company retired |
| Proof a claim is backed by real retirements | Which credits back it |
| Which registry and auditor are authoritative | The company's commercial position |

That is not a transparency problem or a privacy problem. It is a *selective
disclosure* problem, which is precisely what Midnight is for.

---

## How Canopy works

One Compact contract, four roles, one loop.

```
Registry  ──issues──▶  credit commitment  ──▶ public Merkle tree
                                              (supply is auditable,
                                               ownership is not)

Company   ──sends───▶  nullifier          ──▶ public transfer set
                     ──plus a fresh commitment for the buyer
                       (no buyer, no seller, no size on chain)

Company   ──retires──▶ nullifier          ──▶ public retirement set
                       (unforgeable,           (double retirement is
                        unlinkable)             structurally impossible)
                     ──folds tonnage into──▶ private tally commitment

Company   ──claims───▶ "≥ N tonnes, FY2026 Q3"
                       proved against the sealed tally

Auditor   ──attests──▶ on-chain attestation
                       after off-chain disclosure of the openings
```

### What each mechanism buys

**Credits are commitments.** A credit enters the chain as
`hash(serial, tonnes, ownerKey, salt)`. The registry publishes its batch totals
— that is what a registry is for — but the individual holder and size are known
only to the holder.

**Spending publishes a nullifier, not a serial.** The nullifier is
`hash("canopy:spend:", commitment, ownerSecretKey)`. Because it depends on the
owner's secret it cannot be forged by anyone else, and it cannot be matched back
to a published serial by an observer. Inserting it twice is rejected by the
contract, so double counting is not *detected* — it is unrepresentable.

It is keyed to the commitment rather than the serial deliberately. A serial
outlives a transfer; a commitment does not. Keying on the serial would let a
seller spend a note the buyer now owns — and binding the seller's key in to
close that hole would permanently brick any credit that came back to a previous
holder. Keying on the commitment gives every note exactly one nullifier for its
whole life, in exactly one pair of hands.

**A trade is a spend and a re-issue.** `transferCredit` burns the seller's note
and inserts `hash(serial, tonnes, newOwner, freshSalt)` for the buyer. The chain
records one nullifier and one new leaf and cannot link them. Tonnage cannot
change on the way: the old note had to open against the tree, which binds its
size, and the new commitment is built from the same value inside the circuit.
The note that opens it travels off-chain, the way a shielded memo would.

**The tally is a commitment the company alone can open.** Each company's public
entry is `hash("canopy:tally:", tonnes, hash(secretKey, tonnes))`. It is binding
(it cannot be re-opened to a different number) and hiding (the blinding value
depends on a secret). A claim is a proof that the sealed number is at least the
published threshold.

**Not even the registry can follow a credit.** The registry knows every serial
it issued and who it issued it to — and still cannot tell which credits were
retired or how many tonnes a company holds, because both the nullifier and the
tally nonce require the holder's secret key. The best-informed party in the
system learns nothing.

**The tally is reconstructed, never stored.** A company recovers its own total
by testing its credit notes against the public nullifier set — the same way a
shielded wallet recovers a balance. There is no local counter to drift out of
sync if a transaction fails.

**Roles are separated by domain-separated key derivation.** Registry, auditor
and company public keys are derived from distinct prefixes, so a company key can
never be replayed as a registry key.

### Why this needs Midnight specifically

- **Public and private state in one contract.** The nullifier set has to be
  public for uniqueness to mean anything; the tonnages have to be private for
  the product to be usable. Midnight is the platform where both live in the same
  ledger.
- **Witness data never leaves the client.** Tonnages, serials and salts are
  witnesses. They are inputs to the proof, not to the chain.
- **`disclose()` is mandatory and compiler-enforced.** Compact statically tracks
  every value derived from a witness and refuses to compile a circuit that lets
  one reach public state without an explicit `disclose()`. Privacy is a
  compile-time property here, not a code-review convention. Building Canopy, the
  compiler rejected several early drafts for exactly this reason.

---

## Try it

![Retiring a credit](docs/images/retirement.png)

*The company's private credit ledger on the left; the complete public state of
the contract on the right. Retiring moves a nullifier into the public set and
tells the world nothing else.*

The deployed demo needs no wallet, no extension and no signup. One funded
wallet on the backend pays the fees; the four roles are separate *contract*
identities derived per visitor, so two people exploring at once never collide.

Every button writes a real transaction to the deployed contract. The attempts
that are supposed to fail fail during local circuit execution, which is why they
come back instantly and cost nothing.

![Trying to cheat](docs/images/cheating.png)

The site also explains its own cryptography, so evaluating Canopy needs no
clone of this repository:

![How it works](docs/images/how-it-works.png)

---

## Running it yourself

### Prerequisites

- Node.js 24+ (see `.nvmrc`)
- Docker
- The Compact toolchain:
  ```bash
  curl --proto '=https' --tlsv1.2 -LsSf \
    https://github.com/midnightntwrk/compact/releases/latest/download/compact-installer.sh | sh
  export PATH="$HOME/.local/bin:$PATH"
  compact update
  ```
  Canopy is built against compiler `0.31.1` (language `0.23.0`, ledger
  `8.0.2`, runtime `0.16.0`).

### Build

```bash
npm install

# compile the contract and generate proving keys (~3 minutes)
npm run compact --workspace @canopy/contract
npm run build   --workspace @canopy/contract

# the contract's own test suite — no network required
npm test        --workspace @canopy/contract
```

### Run

```bash
# proof server
docker run -d --name canopy-proof-server -p 6300:6300 \
  -e PORT=6300 midnightntwrk/proof-server:8.1.0

# deploy to Midnight PreProd — prints the fee wallet address, waits for you to
# fund it once at https://midnight-tmnight-preprod.nethermind.dev/, then
# registers DUST and deploys by itself
CANOPY_NETWORK=preprod npm run deploy-contract --workspace @canopy/server

# backend + frontend
npm run build --workspace @canopy/web
npm start     --workspace @canopy/server     # serves the UI and the API on :3001
```

For frontend development, `npm run dev --workspace @canopy/web` proxies `/api`
to the backend on port 3001.

### Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `CANOPY_NETWORK` | `preprod` | `preview` or `preprod`. Defaults to PreProd because the Preview faucet was returning `NOT_SERVING / SYNC_STUCK_RECOVERY` throughout this build. |
| `CANOPY_PROOF_SERVER` | `http://127.0.0.1:6300` | Proof server URL |
| `CANOPY_SEED` | a development seed | Master seed for the fee wallet and role keys |
| `PORT` | `3001` | Backend port |
| `CANOPY_STATIC_MIRROR` | unset | Copy `web/dist` here at startup so a web server can serve the page while the wallet blocks the event loop. See [docs/deployment.md](docs/deployment.md). |

`CANOPY_SEED` derives everything: change it and you get a different fee wallet
and different registry/auditor identities, which means you must redeploy. To
reuse a wallet you have already funded, set `CANOPY_WALLET_SEED` to its seed
instead — that skips the captcha-gated faucet entirely.

---

## Layout

```
contract/   canopy.compact, witnesses, and the simulator test suite
server/     Express API, fee wallet, per-visitor session identities
web/        React frontend — the guided tour and the chain inspector
docs/       architecture, deployment, submission notes
```

### Where the data lives

| | |
| --- | --- |
| Midnight PreProd | the contract's public state — commitments, nullifiers, tallies, claims, counters |
| server memory only | serials, tonnages, salts and secret keys; witness data is never written to disk or chain |
| `server/wallet-state.<network>.json` | the cached DUST scan, rewritten every 10 minutes |
| `server/history.<network>.jsonl` | every transaction and a chain snapshot every 15 minutes, so the site can show history rather than only current state |
| `server/deployment.json` | the deployed contract address |
| browser `localStorage` | one session id, nothing else |

`contract/src/canopy.compact` is the whole protocol and is worth reading first;
it is about 200 lines.

- [docs/architecture.md](docs/architecture.md) — the data model, the four
  mechanisms, and what the Compact compiler enforces
- [docs/what-we-learned.md](docs/what-we-learned.md) — the things that cost us
  hours and are not in Midnight's documentation: what node error 117 really is,
  the DUST budget in numbers, why a drained fee wallet cannot re-register
  itself, and the witness rule that a fraud test which does not lie proves
  nothing
- [docs/deployment.md](docs/deployment.md) — standing up the public demo

---

## Tests

`contract/src/test/canopy.test.ts` runs the contract in-process, so the full
four-role story and every way of cheating at it are exercised without a node, a
wallet or a proof server:

- a credit cannot be retired twice
- a credit that was sent to someone else cannot then be retired by the sender
- a credit cannot be sent to two holders
- a retired credit cannot be sent on
- a credit that comes back to a previous holder is still spendable
- a transfer writes no buyer to the chain, only a commitment
- a transfer conserves tonnage and cannot be built on a borrowed Merkle path
- a credit cannot be retired by someone who does not own it
- a credit the registry never issued cannot be retired
- **a dishonest prover cannot substitute someone else's Merkle path** — this one
  installs a deliberately lying `creditPath` witness, because fraud tested
  through the honest witness implementation proves nothing about the circuit
- a claim larger than what was retired cannot be published
- a company that retired nothing can claim nothing
- only the accredited auditor can attest
- only the registry can issue supply
- two companies' tallies stay independent and mutually opaque
- the on-chain tally is a commitment, and no nullifier equals its serial

---

## Honest limitations

These are real, and stating them is more useful than pretending otherwise.

- **Accounting, not quality.** Canopy guarantees a credit is retired once and
  that claims are backed. It says nothing about whether the underlying project
  ever avoided a tonne of carbon. Junk credits accounted for perfectly are still
  junk. Integrating project-rating attestations is the obvious next layer.
- **Trusted registry and auditor.** Both are permissioned keys fixed at
  deployment, mirroring how real registries and accredited verifiers work. A
  production system would want a set of registries and revocable auditor
  credentials.
- **Trading has no settlement leg.** `transferCredit` moves a credit when the
  seller says so. Payment, escrow and atomic delivery-versus-payment are
  somebody else's problem here, as they are in most registry software.
- **Activity is visible even though volumes are not.** Each retirement updates
  the company's public tally entry, so an observer can count how many
  retirement transactions a company made. The tonnages stay hidden. Hiding the
  event count too would need the tally to move to a nullifier-chained
  commitment.
- **Tree capacity.** The credit tree is depth 10, so 1,024 notes per deployment,
  and issues and transfers share that budget. Raising it costs one hash per level
  inside two circuits and nothing at all on chain. See **What it costs** on the
  live site for the measured numbers.
- **The very first start is slow.** Midnight pays fees in DUST, which is
  generated by registered NIGHT and can only be found by replaying the ledger
  from genesis — about two hours on a fast machine, five on a small VM. The
  scan is then serialised to `server/wallet-state.<network>.json` and restored
  on boot, so every later start takes seconds. `server/src/scripts/restore-check.ts`
  proves the restored wallet resumes where the scan stopped instead of
  replaying.
- **The demo's fee wallet is custodial.** That is what removes the wallet
  install from a visitor's path. It has no bearing on the protocol: the fee
  payer and the contract identity are deliberately separate.
- **One fee wallet is a throughput ceiling.** Midnight regenerates DUST from
  registered NIGHT at a fixed rate — for one UTxO, 8.27×10¹² per second toward a
  cap of 5×10¹⁸ — and every visitor's transaction is paid from the same balance.
  Submissions wait for an affordable fee rather than failing, and the interface
  says so when they do. A production deployment gives each company its own
  wallet and its own registered NIGHT, and their transactions are independent;
  the contract has no global lock. **What it costs** on the live site shows the
  current balance, the measured regeneration rate and the sustained rate it
  supports. [docs/what-we-learned.md](docs/what-we-learned.md) has the
  arithmetic and how we found it the hard way.
- **A sandbox is created only when you ask for one.** Opening the site costs
  nothing; starting the tour or the Explore tab spends four real transactions
  giving you your own company keys. Reading is free.

---

## License

Apache-2.0. Built for the Brainwave 2026 Midnight Track.

---

## Acknowledgements

The project skeleton — workspace layout, provider wiring and build scripts —
started from Midnight's `create-mn-app` `bboard` template. The contract, the
backend, the frontend and the documentation are this project's own.
