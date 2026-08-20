# Canopy — Devpost submission

*Paste-ready copy for the Brainwave 2026 Midnight Track submission form.*

---

## Tagline

Carbon claims you can verify. Books you cannot read.

---

## Inspiration

In 2022 the crypto industry tried to fix carbon markets. Toucan bridged roughly
22 million Verra-registered credits onto a public chain. Verra's response was to
ban tokenisation outright.

That ban is usually told as a story about regulators disliking crypto. It is
better understood as an architecture failure. On a transparent-by-default
ledger, every company's offset position is visible to its competitors — and
offset volume is a direct read on production volume and emissions profile. A
registry also had no cryptographic way to stop a retired credit from continuing
to trade; "double counting" was something you detected afterwards by
reconciling records.

Then we looked at the calendar. From **September 2026** the EU Green Claims
Directive makes unsubstantiated offset-based "climate neutral" claims illegal
across the EU, prohibits self-certification, and requires verification by an
accredited body with no financial interest in the outcome.

So the market now needs two things that normally contradict each other: public
proof that a credit was retired exactly once, and privacy for the commercial
data behind it. That is not a transparency problem or a privacy problem. It is
a selective disclosure problem — which is precisely what Midnight exists for.

The market blockchain got banned from is the market Midnight was built for.

## What it does

Canopy is a carbon registry where a company can prove *"in FY2026 Q3 we retired
at least 1,000 tonnes"* without revealing the real figure, which credits it
used, or what it still holds — while the chain guarantees no credit is ever
retired twice.

Four roles, one loop:

1. A **registry** issues credits. Batch supply is public; each individual credit
   enters the chain as an opaque commitment.
2. Companies **trade** them. A transfer burns the seller's note and plants a
   fresh commitment for the buyer, so the chain records that a credit moved and
   nothing about who moved it or how large it was.
3. A **company** retires credits. The chain receives a nullifier — unforgeable,
   unlinkable to the published serial, and impossible to insert twice.
4. The company **publishes a claim** — a threshold, proved against a sealed
   tally only it can open.
5. An **accredited auditor** is shown the underlying records off-chain, verifies
   them against the chain, and attests on-chain.

Then we invite you to cheat. Retire the same credit twice; claim more than you
retired; spend a credit you do not own; sell a credit and retire it anyway. Each
attempt is refused, and the site shows you the contract's own words for why.

## How we built it

One Compact contract (~200 lines), a Node backend, and a React frontend.

**A credit is a commitment.**
`hash(serial ‖ tonnes ‖ ownerKey ‖ salt)`, inserted into a public
`HistoricMerkleTree`. Supply is auditable; ownership is not on chain at all.
Retiring requires a membership proof, so a credit the registry never issued
cannot be spent.

**Spending publishes a nullifier, not a serial.**
`hash("canopy:spend:" ‖ commitment ‖ ownerSecretKey)`. Including the owner's secret
makes it unforgeable by anyone else and unlinkable to the public serial list,
while asserting the nullifier is in neither spend set before insertion makes a second
retirement unrepresentable. Double counting is not detected here — it cannot be
expressed.

**The tally is a commitment only its owner can open.**
`hash("canopy:tally:" ‖ tonnes ‖ hash(secretKey ‖ tonnes))`. Binding, so it
cannot be reopened to a flattering number; hiding, because the blinding value
depends on a secret. Deriving the nonce from the key rather than storing it
means a company keeps no local bookkeeping that can drift out of sync when a
transaction fails — it recovers its total by testing its own credit notes
against the public nullifier set, exactly as a shielded wallet recovers a
balance.

**A trade is a spend and a re-issue.** `transferCredit` burns the seller's note
and inserts `hash(serial ‖ tonnes ‖ buyer ‖ freshSalt)`. The chain gets one
nullifier and one new leaf and cannot link them, so a credit changes hands with
no buyer, no seller and no size on the record. Tonnage is conserved
structurally: the old note had to open against the tree, which binds its size,
and the new commitment is built from the same variable inside the circuit.

**Roles are separated by domain-separated key derivation**, so a company key can
never be replayed as a registry or auditor key.

**No wallet, for anyone.** In Midnight the account paying a fee and the identity
a circuit reasons about are different things. Canopy's contract identities come
from a secret in private state, so one funded wallet on the server acts as every
role, and each visitor gets their own derived company keys. Two people exploring
at the same time never collide. A judge opens a URL and starts clicking.

## Why Midnight, specifically

Three requirements had to hold in one contract, and Midnight is what lets them
coexist:

- **Public and private state together.** The nullifier set must be public for
  uniqueness to mean anything; tonnages must be private for the product to be
  usable at all.
- **Witness data never leaves the client.** Serials, tonnages and salts are
  inputs to the proof, not to the chain.
- **`disclose()` is mandatory and compiler-enforced.** Compact statically tracks
  every value derived from a witness and refuses to compile a circuit where one
  reaches public state unmarked. Several drafts of this contract were rejected
  for exactly that — including one that wrote a Merkle root computed from a
  private path straight to the ledger. Privacy is a compile-time property here,
  not a code-review convention.

## Challenges we ran into

The Compact compiler was the best teacher and the strictest reviewer. Two
lessons that are not obvious from the documentation: every exported circuit
parameter is treated as private until you disclose it, and `Set.member()` leaks
exactly as much as `Set.insert()` because both are ledger operations.

The bug we are most glad we found was a soundness hole, and we found it by
attacking our own contract rather than by reading it. `retireCredit` passed the
credit's commitment *into* the `creditPath` witness — but a witness is local
code the prover controls, and passing a value in constrains nothing about what
comes back. A modified prover could return the authentication path of somebody
else's genuine credit, satisfy the Merkle root check against the honest root,
and retire a credit of any size that was never issued. We reproduced it: a claim
of 1,000,000 tonnes against a registry that had issued 600.

The fix is one line — `assert(path.leaf == commitment, …)`. The more useful
outcome was realising that our fraud tests had been passing for the wrong
reason: they exercised cheating through the *honest* witness implementation,
which of course refuses to cheat. The suite now installs a deliberately lying
witness and asserts the circuit rejects it. **A ZK circuit's security is the set
of constraints it imposes on witness outputs, never the arguments it passes in.**

One ordering bug was genuinely subtle. Because the tally is reconstructed from
the nullifier set, reading it *after* inserting the new nullifier would count
the credit being retired right now and double it. The circuit reads the tally
first, and the reason is commented in the contract.

The longest single delay was neither code nor infrastructure but a missing
measurement. A wallet cannot pay a fee until its dust scanner reaches the block
that registered its NIGHT for generation, and that scan starts from genesis. On
PreProd's 2.1 million blocks it runs for about three hours — during which the
balance, and every projection computed from it, reads zero. A working scan and
a wedged one are indistinguishable when the only observable is a zero. We chased
two wrong theories before adding a progress log, at which point the answer was
immediate: 199 blocks per second, steadily. The fix was a timeout sized from the
measurement rather than a guess, and the server now serves the site while the
wallet warms up instead of refusing connections for hours.

**The one that took days: `1010: Invalid Transaction: Custom error: 117`.**
The contract deployed cleanly and then every single contract call was rejected
by the node — not by the circuit, not by an RPC failure, but during ledger
validation, with an eight-bit error code and no text. The fee wallet held 2.6
DUST and was synced. We worked through six hypotheses and disproved every one:
two processes sharing a wallet, the wallet not having observed its own spend,
DUST needing time to mature, a proof too large for that circuit, verifier keys
differing between the deploying and the proving machine, and the fault being
specific to one circuit. Each was ruled out with evidence — the proving keys, for
instance, were compared byte for byte across machines.

The answer was in the fee. Code 117 is `TransactionMalformed(NotNormalized)`:
when `feesWithMargin` evaluates to zero and no `additionalFeeOverhead` is set,
the wallet emits an empty `DustActions`, and `DustActions::well_formed` rejects
it. `testkit-js` ships `DEFAULT_DUST_OPTIONS.additionalFeeOverhead` as `0n`. A
`ContractDeploy` survives that; a contract call does not — which is exactly the
shape of a system that deploys and then never works again. Setting a positive
overhead fixed it on the first attempt.

Two things we would do differently. We spent days reasoning about a number
instead of decoding it; Midnight publishes the full code table and reading it
first would have cost ten minutes. And our own error reporting hid the evidence:
midnight-js wraps the node's answer in an Effect tagged error whose message is
always the invariant string "Transaction submission error". The server now reads
the whole error graph and decodes node codes into sentences, so the next one of
these is a paragraph in a log rather than an archaeology project.

**And then the fee wallet ran out.** With 117 fixed, seeding a fresh contract
landed thirteen transactions and died with `Insufficient Funds: could not
balance dust`. Midnight pays fees in DUST, which is regenerated by registered
NIGHT at a fixed rate; `LedgerParameters.initialParameters().dust` gives a cap
of `night × 5,000,000,000` and seven days to reach it, which for our one UTxO is
8.27×10¹² per second — exactly the slope we had measured off the wallet without
understanding it. The seeder was submitting faster than that, and three days of
accrued balance went in fourteen minutes.

Where it went took another round to pin down. Deserialising the transactions
shows what was actually declared: `v_fee: 300000000000001`, which is the fee
plus the overhead we had set — and a `new_commitment`, so the change output
exists. The ledger took 3×10¹⁴ per transaction. The wallet's balance fell by
2×10¹⁷ per transaction, 680 times as much, and never recovered. The chain was
never the problem; the wallet's local account of its own output was, and a
cached wallet state is exactly the sort of thing that can be wrong about a
zero.

Either way the design conclusion is the same and it is now on the site: DUST,
not proving and not the node, is what caps how fast an always-on Midnight
application can write. Canopy waits for an affordable fee rather than
discovering it cannot pay, tells the visitor that is what they are waiting for,
and only spends transactions on someone who actually asked for a sandbox.

We also lost time to infrastructure rather than code: the Preview faucet was
returning `NOT_SERVING / SYNC_STUCK_RECOVERY` while still showing a green
captcha, so requests appeared to succeed and silently did nothing. We diagnosed
it against the faucet's health endpoint and moved the deployment to PreProd.

## Accomplishments we're proud of

The fraud demonstrations return **instantly and cost nothing**, because invalid
attempts fail during local circuit execution before a proof is ever built. That
is not a demo shortcut — it is how the system behaves in production, and it
makes the security argument something a visitor can feel rather than read.

The contract's test suite exercises the entire four-role story and every attack
on it in-process, with no node, wallet or proof server required.

## What we learned

Privacy engineering is mostly about deciding what *must* be public. The
temptation is to hide everything; the discipline is recognising that the
nullifier set has to be fully public or the guarantee evaporates, and that batch
supply should be public because publishing supply is what a registry is for.

## What's next for Canopy

- **Credit quality, not just credit accounting.** Canopy guarantees a credit is
  retired once and that claims are backed. It says nothing about whether the
  underlying project avoided a tonne of carbon. Project-rating attestations are
  the natural next layer.
- **Settlement**, so a trade can be delivery-versus-payment rather than the
  seller simply choosing to hand a credit over.
- **Hiding activity as well as volume.** Today an observer can count how many
  retirement transactions a company made, though not their size. A
  nullifier-chained tally would close that.
- **Multiple registries and revocable auditor credentials**, rather than two
  keys fixed at deployment.

## Demo video — shot list (3 minutes)

Record the site itself, one continuous screen capture. The tour is already
paced for this; do not narrate the architecture, narrate what is on screen.

| Time | Screen | Say roughly |
| --- | --- | --- |
| 0:00–0:25 | Step 1, the problem | "Toucan bridged 22 million carbon credits onto a public chain. Verra banned tokenisation. The reason was architectural — a public ledger exposes every company's position. And from September this year, unproven offset claims become illegal in the EU." |
| 0:25–0:45 | Step 2, supply; point at the inspector | "The registry publishes supply. Each credit lands as a hash. The panel on the right is the entire public state — everything anyone can see." |
| 0:45–1:10 | Step 3, send a credit | "Companies trade before they retire. This burns the seller's note and plants a fresh one for the buyer. The chain sees one nullifier and one new commitment, and cannot tell you they are related." |
| 1:10–1:40 | Step 4, retire a credit | "EcoCorp retires 600 tonnes. Watch what the chain gets: one nullifier. Not which credit, not whose, not how many tonnes. Not even the registry that issued it can tell." |
| 1:40–2:00 | Step 5, drag the slider, publish | "It claims at least 1,000 tonnes. It actually retired 1,500. The proof says 'at least' — the real number never leaves the browser." |
| 2:00–2:35 | Step 6, all four fraud buttons | "Now try to cheat." Click each; let the red rejections land. "Instant, because these fail while the proof is being built. There is no transaction that expresses double counting." |
| 2:35–2:50 | Step 7, auditor | "The accredited auditor the new rules require sees every serial, and attests on chain. Everyone else still sees a hash." |
| 2:50–3:00 | The What it costs tab, then the recap | "Every number here is measured from transactions this deployment actually landed. Public forever on the left, never disclosed on the right. That is the whole product." |

Close on the deployed contract address. Do not show a wallet — the fact that
there isn't one is part of the point.

## For the ecosystem

`docs/what-we-learned.md` is the write-up we wanted to find when we started: what
node error 117 really is and why testkit's default causes it, the DUST budget in
numbers and what it means for anything always-on, why a drained fee wallet
cannot re-register itself out of the hole, the two compiler behaviours that are
not spelled out, and the rule that a fraud test which does not install a lying
witness proves nothing about a circuit.

## Built with

Midnight · Compact 0.23 · TypeScript · React · Node · Express · Vite · Docker

## Honest limitations

Stated plainly in the README and on the site itself: Canopy fixes carbon
accounting, not carbon quality; the registry and auditor are trusted keys, as
they are in the real market; trades have no settlement leg; retirement
*events* are visible even though volumes are not; and the credit tree is depth
10, so 1,024 credits per deployment.

We would rather a judge read those from us than find them.
