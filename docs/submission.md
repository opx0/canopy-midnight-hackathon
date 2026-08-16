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
2. A **company** retires credits. The chain receives a nullifier — unforgeable,
   unlinkable to the published serial, and impossible to insert twice.
3. The company **publishes a claim** — a threshold, proved against a sealed
   tally only it can open.
4. An **accredited auditor** is shown the underlying records off-chain, verifies
   them against the chain, and attests on-chain.

Then we invite you to cheat. Retire the same credit twice; claim more than you
retired; spend a credit you do not own. Each attempt is refused, and the site
shows you the contract's own words for why.

## How we built it

One Compact contract (~200 lines), a Node backend, and a React frontend.

**A credit is a commitment.**
`hash(serial ‖ tonnes ‖ ownerKey ‖ salt)`, inserted into a public
`HistoricMerkleTree`. Supply is auditable; ownership is not on chain at all.
Retiring requires a membership proof, so a credit the registry never issued
cannot be spent.

**Retirement publishes a nullifier, not a serial.**
`hash("canopy:retire:" ‖ serial ‖ ownerSecretKey)`. Including the owner's secret
makes it unforgeable by anyone else and unlinkable to the public serial list,
while `assert(!retiredCredits.member(nullifier))` before insertion makes a second
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
- **Secondary trading**, via a spend-and-reissue circuit — the nullifier
  machinery is already the hard part.
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
| 0:25–0:50 | Step 2, supply; point at the inspector | "The registry publishes supply. Each credit lands as a hash. The panel on the right is the entire public state — everything anyone can see." |
| 0:50–1:25 | Step 3, retire a credit | "EcoCorp retires 600 tonnes. Watch what the chain gets: one nullifier. Not which credit, not whose, not how many tonnes. Not even the registry that issued it can tell." |
| 1:25–1:50 | Step 4, drag the slider, publish | "It claims at least 1,000 tonnes. It actually retired 1,500. The proof says 'at least' — the real number never leaves the browser." |
| 1:50–2:30 | Step 5, all three fraud buttons | "Now try to cheat." Click each; let the red rejections land. "Instant, because these fail while the proof is being built. There is no transaction that expresses double counting." |
| 2:30–2:50 | Step 6, auditor | "The accredited auditor the new rules require sees every serial, and attests on chain. Everyone else still sees a hash." |
| 2:50–3:00 | Recap split panel | "Public forever on the left. Never disclosed on the right. That is the whole product." |

Close on the deployed contract address. Do not show a wallet — the fact that
there isn't one is part of the point.

## Built with

Midnight · Compact 0.23 · TypeScript · React · Node · Express · Vite · Docker

## Honest limitations

Stated plainly in the README and on the site itself: Canopy fixes carbon
accounting, not carbon quality; the registry and auditor are trusted keys, as
they are in the real market; there is no secondary market yet; retirement
*events* are visible even though volumes are not; and the credit tree is depth
10, so 1,024 credits per deployment.

We would rather a judge read those from us than find them.
