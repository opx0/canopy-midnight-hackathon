# Architecture

## The shape of the problem

A carbon claim has to satisfy two audiences with opposite needs.

The **public** needs to know a credit was retired exactly once, and that a
published claim is backed by real retirements. The **company** needs its offset
volumes kept out of competitors' hands, because offset volume is a direct read
on production volume and emissions profile.

Conventional ledgers force a choice. Canopy does not, because Midnight lets a
single contract hold public state, private witness data, and a compiler-enforced
boundary between them.

## Data model

### Public ledger state

| Field | Type | Why it is public |
| --- | --- | --- |
| `creditTree` | `HistoricMerkleTree<10, Bytes<32>>` | Commitments to every issued credit. Membership proves a credit is real; the tree reveals nothing about holders. Historic, so a proof built against an earlier root still verifies after more credits are minted. |
| `retiredCredits` | `Set<Bytes<32>>` | Nullifiers of retired notes. Uniqueness has to be publicly checkable or it means nothing. |
| `transferredCredits` | `Set<Bytes<32>>` | Nullifiers of notes that were passed on. Kept apart from retirements so the public retirement count cannot be inflated by trading, and so the tally witness can recover a company's retired tonnage without counting credits it merely sold. |
| `batches` | `Map<Bytes<32>, Batch>` | Registry supply — project, vintage, tonnage. Publishing supply is what a registry is *for*. |
| `companies` | `Map<Bytes<32>, Bytes<32>>` | Company public key → tally commitment. The key is public so claims are attributable; the value hides the volume. |
| `claims` | `Map<Bytes<32>, Claim>` | Published thresholds and their attestation status. |
| `registryKey`, `auditorKey` | `Bytes<32>` | The authorities, fixed at deployment. |

### Private witness state

Never transmitted, never stored on chain:

```ts
type CreditNote = { serial, tonnes, salt, batchId };
type CanopyPrivateState = { secretKey, credits: CreditNote[] };
```

Three witnesses feed the circuits: `secretKey()`, `creditPath(commitment)` and
`tallyTonnes()`.

## The four mechanisms

### 1. Credits are commitments

```
commitment = persistentHash(serial ‖ tonnes ‖ ownerPublicKey ‖ salt)
```

The registry inserts this into `creditTree`. Supply is auditable in aggregate;
individual ownership and size are not on chain at all. Retiring requires a
Merkle membership proof, so a credit that was never issued cannot be spent.

### 2. Spending publishes an unlinkable nullifier

```
nullifier = persistentHash("canopy:spend:" ‖ commitment ‖ ownerSecretKey)
```

Three properties fall out of including the secret key:

- **Unforgeable.** Only the owner can compute it, and only the owner can supply
  the commitment opening the circuit checks alongside it.
- **Unlinkable.** An observer holding the published serial list cannot match a
  nullifier to a serial, because the mapping needs a secret.
- **Unique.** Both `retireCredit` and `transferCredit` assert the nullifier is
  in neither set before inserting it into their own. A note can be spent once,
  either way, and never again.

That last point is the design's centre of gravity. Double counting is not
detected after the fact by reconciling records — it is unrepresentable.

**Why the commitment and not the serial.** The first version keyed the
nullifier to `(serial, secretKey)`, which is correct as long as credits never
move. A serial outlives a transfer, so once one exists the seller's nullifier
and the buyer's differ, and the seller can retire a credit they already sold.
Binding the sender's key in closes that, but then a credit returning to a
previous holder is permanently unspendable — its nullifier was burnt on the way
out. The commitment changes on every hop, so keying on it gives each note
exactly one nullifier, for its whole life, in exactly one pair of hands. The
test suite pins both cases.

### 3. The tally is a commitment only its owner can open

```
tallyCommitment(sk, tonnes) = persistentHash("canopy:tally:" ‖ tonnes ‖ nonce)
nonce                       = persistentHash("canopy:nonce:" ‖ sk ‖ tonnes)
```

Deriving the blinding nonce from the secret key rather than storing it means a
company keeps no local bookkeeping that could drift out of sync with the chain
if a transaction fails. The commitment is binding (it cannot be reopened to a
different number) and hiding (the nonce depends on a secret).

`retireCredit` reads the current tally, verifies it against the on-chain
commitment, and writes the updated one. `transferCredit` does not touch the
tally at all: passing a credit on is not retiring it, and the seller's total
must not move. `publishClaim` proves
`tally >= threshold` without revealing `tally`.

### 4. A trade is a spend and a re-issue

```
transferCredit(serial, tonnes, salt, recipient, freshSalt)
  → nullify persistentHash("canopy:spend:" ‖ oldCommitment ‖ sellerSecretKey)
  → insert  persistentHash(serial ‖ tonnes ‖ recipient ‖ freshSalt)
```

The seller proves membership of their own note, burns it, and plants a new
commitment for the buyer. Nothing identifies either party: the recipient is a
circuit parameter, and a parameter is private until `disclose()` says otherwise,
so only the resulting commitment reaches the chain. The fresh salt is what stops
an observer from matching the incoming leaf to the outgoing nullifier by
recomputing the hash.

Tonnage is conserved structurally rather than by assertion. The old commitment
had to open against the tree, which binds `(serial, tonnes, seller, salt)`, and
the new commitment is built from the same `tonnes` variable inside the circuit —
a prover cannot supply one value to the check and a different one to the insert.

Transfers and issues share the credit tree, so both count against its 1,024-note
capacity. The note that opens the new commitment travels off-chain; the contract
neither knows nor cares how it got there.

**Ordering constraint.** `tallyTonnes()` is read *before* the nullifier is
inserted. The tally is reconstructed by testing the holder's own notes against
the nullifier set — the way a shielded wallet recovers a balance — so reading it
after insertion would count the credit being retired right now and double it.
This is commented in the contract because it is not obvious from the code.

### Witnesses constrain nothing until you constrain them

The single most important line in `retireCredit` is easy to leave out:

```compact
const path = creditPath(commitment);
assert(path.leaf == commitment, "the supplied path is not for this credit");
```

A witness is local code the prover controls. Passing `commitment` *into*
`creditPath` does not bind what it returns. `merkleTreePathRoot` folds upward
starting from `path.leaf`, which is witness-supplied — so without that equality
a prover can hand back the authentication path of somebody else's genuine
credit, satisfy `checkRoot` against the honest root, and retire a credit of any
size that was never issued.

An adversarial review of this contract found exactly that hole and reproduced it:
a prover with a modified `creditPath` minted a claim of 1,000,000 tonnes against
a registry that had only ever issued 600. The fix is the one-line assertion
above.

The lesson generalises: **the security of a circuit is the set of constraints it
imposes on witness outputs, never the arguments it passes in.** It also means a
test suite that exercises fraud through the *honest* witness implementation
proves nothing — `contract/src/test/canopy.test.ts` therefore installs a
deliberately lying `creditPath` and asserts the circuit rejects it.

### Role separation

Registry, auditor and company keys are derived from the same secret through
different domain separators (`"canopy:registry:"`, `"canopy:auditor:"`,
`"canopy:company:"`). A company key can never be replayed as a registry key.

## What Compact enforces for us

Compact statically tracks every value derived from a witness and refuses to
compile a circuit where one reaches public state without an explicit
`disclose()`. Several early drafts of this contract were rejected for exactly
that, including one where a Merkle root computed from a private path was written
to the ledger unmarked.

Two subtleties worth recording, both learned from the compiler rather than the
documentation:

- **Every exported circuit parameter is treated as private.** Inputs are witness
  data until you say otherwise, so even `batchId` needs `disclose()` before it
  can be a map key.
- **`Set.member()` discloses as much as `Set.insert()`.** Both are ledger
  operations. The nullifier is disclosed once, before the membership test, and
  reused for the insertion.

## System layout

```
        browser (no wallet, no extension)
              │  REST + polling
              ▼
        server ── one funded wallet ─────────► Midnight node
          │      pays every transaction fee
          │
          ├── per-visitor contract identities
          │   (registry / EcoCorp / FraudCorp / auditor)
          │
          └── proof server (Docker) ─────────► ZK proofs
```

### Why a visitor needs no wallet

The fee payer and the contract identity are deliberately different things. The
wallet pays for a transaction; the identity the circuits reason about comes from
`secretKey()` in private state. One funded wallet can therefore act as every
role, and each visitor gets their own derived company keys:

```
companySecretKey = sha256("canopy" ‖ masterSeed ‖ "company" ‖ sessionId ‖ role)
```

Two people exploring at the same time retire different credits and publish
different claims against the same deployed contract without colliding.

### Transactions are serialised

Every action is funded by one wallet, and two transactions balancing against the
same UTXO set concurrently would conflict, so the server runs them through a
promise queue. Actions are started as jobs and polled, because proving and
settling takes long enough that holding an HTTP request open would be fragile.

### Rejections cost nothing

Attempts that violate the contract fail during *local circuit execution*, before
a proof is built or a transaction submitted. That is why the fraud demonstrations
return instantly and consume no funds — and it is a fair reflection of how the
system behaves in production.

## Testing

`contract/src/test/canopy.test.ts` runs the contract in-process through
`CircuitContext`, so the entire four-role story and every attack on it are
exercised with no node, wallet or proof server. `server/src/scripts/smoke.ts`
then replays the same story against the deployed contract, asserting that each
attack is still refused on a live network.
