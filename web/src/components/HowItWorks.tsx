import type { Meta } from "../api.js";
import Commit from "./Commit.js";

export default function HowItWorks({ meta }: { meta?: Meta }) {
  return (
    <>
      <p className="lede">
        Canopy is one Compact contract. Four mechanisms do all the work, and
        each one exists to make a specific kind of lie impossible.
      </p>

      <Diagram />

      <div className="card">
        <h3>1 · A credit is a commitment</h3>
        <pre className="code-block">
          commitment = hash(serial ‖ tonnes ‖ ownerKey ‖ salt)
        </pre>
        <Commit />
        <p style={{ fontSize: 14.5 }}>
          The registry inserts this into a public Merkle tree. Anyone can audit
          how much supply exists; nobody can see who holds a given credit or how
          large it is. Retiring requires a membership proof, so a credit the
          registry never issued cannot be spent — that is the forged-credit
          attack closed.
        </p>
      </div>

      <div className="card">
        <h3>2 · Spending publishes a nullifier, not a serial</h3>
        <pre className="code-block">
          nullifier = hash("canopy:spend:" ‖ commitment ‖ ownerSecretKey)
        </pre>
        <p style={{ fontSize: 14.5 }}>
          Because the owner's secret is an input, the nullifier is{" "}
          <strong>unforgeable</strong> (nobody else can produce it),{" "}
          <strong>unlinkable</strong> (an observer holding the serial list
          cannot match it back), and <strong>unique</strong> (the contract
          refuses to insert one twice).
        </p>
        <div className="note">
          This is the centre of the design. Double counting is not something
          Canopy detects afterwards by reconciling records — there is no
          transaction that expresses it.
        </div>
        <div className="note">
          <strong>Why the commitment and not the serial.</strong> A serial
          outlives a transfer; a commitment does not. Keying the nullifier to
          the serial would let the first holder spend a note the second one now
          owns — and once that hole is closed by binding the sender's key in,
          the same credit coming back to a previous holder would be permanently
          unspendable. Keying it to the commitment gives every note exactly one
          nullifier, for its whole life, in one owner's hands.
        </div>
        <div className="note" style={{ marginBottom: 0 }}>
          <strong>Not even the registry can follow a credit.</strong> It knows
          every serial it issued and to whom, but a nullifier needs the holder's
          secret key, and the registry never has that. The party with the most
          information in the system still cannot tell which credits a company
          retired, or how many tonnes it holds.
        </div>
      </div>

      <div className="card">
        <h3>3 · The tally is a commitment only its owner can open</h3>
        <pre className="code-block">
          tally = hash("canopy:tally:" ‖ tonnes ‖ hash(secretKey ‖ tonnes))
        </pre>
        <p style={{ fontSize: 14.5 }}>
          Binding, so it cannot be reopened to a flattering number. Hiding,
          because the blinding value depends on a secret. A claim is a proof
          that the sealed figure is at least the published threshold — which is
          why claiming more than you retired produces no transaction at all.
        </p>
        <p style={{ fontSize: 14.5 }}>
          A company never stores its own total. It recovers it by testing its
          credit notes against the public nullifier set, exactly as a shielded
          wallet recovers a balance, so nothing can drift out of sync when a
          transaction fails.
        </p>
      </div>

      <div className="card">
        <h3>4 · A trade is a spend and a re-issue</h3>
        <pre className="code-block">
          spend(old note) → nullifier · insert hash(serial ‖ tonnes ‖ newOwner ‖
          freshSalt)
        </pre>
        <p style={{ fontSize: 14.5 }}>
          Carbon credits change hands before they are retired, and the market
          Verra shut down was shut down partly because that trail was public.
          Here a transfer burns the seller's note and plants a fresh commitment
          for the buyer. The chain records one nullifier and one new leaf.
        </p>
        <p style={{ fontSize: 14.5 }}>
          The buyer is never written down — only a commitment to them is, under
          a new blinding value, so the incoming leaf cannot be matched to the
          outgoing nullifier. Tonnage cannot change on the way: the old note had
          to open against the tree, which binds its size, and the new commitment
          is built from the same value inside the circuit.
        </p>
        <div className="note" style={{ marginBottom: 0 }}>
          The note that opens the new commitment travels off-chain, the way a
          shielded memo or an ordinary settlement message would. On this site
          that means the server hands it over; the contract neither knows nor
          cares how it arrived.
        </div>
      </div>

      <h2 style={{ marginTop: 32 }}>The contract, as written</h2>
      <p>
        The whole protocol is about 200 lines of Compact. This is the public
        ledger — everything a validator stores and anyone can read:
      </p>
      <pre className="code-block source">{`export ledger creditTree: HistoricMerkleTree<10, Bytes<32>>;
export ledger retiredCredits: Set<Bytes<32>>;
export ledger transferredCredits: Set<Bytes<32>>;
export ledger batches: Map<Bytes<32>, Batch>;
export ledger companies: Map<Bytes<32>, Bytes<32>>;
export ledger claims: Map<Bytes<32>, Claim>;
export ledger registryKey: Bytes<32>;
export ledger auditorKey: Bytes<32>;
export ledger issuedTonnes: Uint<64>;
export ledger issuedCredits: Counter;
export ledger retirementEvents: Counter;
export ledger transferEvents: Counter;`}</pre>
      <p>
        No tonnage per company, no serial, no owner. And this is everything the
        prover supplies privately — inputs to the proof, never to the chain:
      </p>
      <pre className="code-block source">{`witness secretKey(): Bytes<32>;
witness creditPath(commitment: Bytes<32>): MerkleTreePath<10, Bytes<32>>;
witness tallyTonnes(): Uint<64>;`}</pre>

      <h2 style={{ marginTop: 32 }}>Where the soundness actually lives</h2>
      <p>
        Witnesses are supplied by the prover, so a circuit is only as sound as
        the constraints it puts on what comes <em>back</em> from one. This is{" "}
        <code>retireCredit</code>, unedited:
      </p>
      <pre className="code-block source">{`const commitment = creditCommitment(serial, tonnes, me, salt);
const path = creditPath(commitment);
assert(path.leaf == commitment, "the supplied path is not for this credit");
assert(
  creditTree.checkRoot(disclose(merkleTreePathRoot<10, Bytes<32>>(path))),
  "credit was never issued by the registry"
);`}</pre>
      <div className="note bad">
        <strong>The third line is the one that matters.</strong> Without it a
        dishonest prover returns any valid path from{" "}
        <code>creditPath</code> — one authenticating somebody else's credit —
        and the root check still passes, minting tonnage from nothing. An
        adversarial review of this contract found exactly that, and the
        exploit is in the test suite: a deliberately lying{" "}
        <code>creditPath</code> witness that the circuit now rejects. Testing
        fraud through the honest witness proves nothing about the circuit.
      </div>
      <div className="note">
        <strong>Ordering is load-bearing too.</strong>{" "}
        <code>tallyTonnes()</code> is read <em>before</em>{" "}
        <code>retiredCredits.insert(nullifier)</code>. Reversed, the
        chain-derived tally counts the credit being retired twice.
      </div>

      <h2 style={{ marginTop: 32 }}>What Compact enforces</h2>
      <p>
        Compact tracks every value derived from private data and{" "}
        <strong>refuses to compile</strong> a circuit where one reaches public
        state without an explicit <code>disclose()</code>. Several drafts of
        this contract were rejected for exactly that — including one that wrote
        a Merkle root computed from a private path straight to the ledger.
        Privacy here is a property the compiler checks, not a convention a
        reviewer has to catch.
      </p>
      <p>
        Two things the compiler taught us that the documentation does not say
        outright: every exported circuit parameter is treated as private until
        disclosed, and <code>Set.member()</code> leaks exactly as much as{" "}
        <code>Set.insert()</code> because both are ledger operations.
      </p>

      <h2 style={{ marginTop: 32 }}>Why you needed no wallet</h2>
      <p>
        In Midnight the account paying a transaction fee and the identity a
        circuit reasons about are separate things. Canopy's contract identities
        come from a secret in private state, so one funded wallet on the server
        can act as registry, two companies and an auditor at once — and each
        visitor gets their own derived company keys, which is why two people
        exploring simultaneously never collide.
      </p>

      <div className="note warn">
        <strong>What Canopy does not solve.</strong> It fixes carbon{" "}
        <em>accounting</em>, not carbon <em>quality</em>: a worthless credit
        accounted for perfectly is still worthless. The registry and auditor are
        trusted keys, as they are in the real market. Trading is peer to peer with
        no settlement leg — a credit moves when the seller says so, and payment
        is somebody else's problem. And while volumes stay private, an observer
        can still count how many transactions a company made, and the credit
        tree holds 1,024 notes per deployment, issues and transfers together.
      </div>

      {meta && (
        <div className="foot">
          Deployed on Midnight {meta.network} at{" "}
          <code>{meta.contractAddress}</code>.
        </div>
      )}
    </>
  );
}

function Diagram() {
  return (
    <svg
      viewBox="0 0 720 250"
      role="img"
      aria-label="Registry issues commitments to a public tree; a company retires them by publishing nullifiers and folding tonnage into a private tally; claims are proved against that tally and attested by an auditor."
      style={{ width: "100%", height: "auto", margin: "8px 0 24px" }}
    >
      <defs>
        <marker
          id="arrow"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#4ade80" />
        </marker>
      </defs>

      <rect x="0" y="0" width="720" height="112" rx="10" fill="#070b09" stroke="#1e2a24" />
      <text x="16" y="24" fill="#61756a" fontSize="11" letterSpacing="1.2">
        PUBLIC LEDGER
      </text>

      <rect x="20" y="38" width="150" height="54" rx="8" fill="#111815" stroke="#2c3d34" />
      <text x="95" y="61" fill="#e8f0ea" fontSize="13" textAnchor="middle">
        credit tree
      </text>
      <text x="95" y="79" fill="#61756a" fontSize="11" textAnchor="middle">
        commitments
      </text>

      <rect x="200" y="38" width="150" height="54" rx="8" fill="#111815" stroke="#2c3d34" />
      <text x="275" y="61" fill="#e8f0ea" fontSize="13" textAnchor="middle">
        nullifier set
      </text>
      <text x="275" y="79" fill="#61756a" fontSize="11" textAnchor="middle">
        spent, exactly once
      </text>

      <rect x="380" y="38" width="150" height="54" rx="8" fill="#111815" stroke="#2c3d34" />
      <text x="455" y="61" fill="#e8f0ea" fontSize="13" textAnchor="middle">
        tally commitments
      </text>
      <text x="455" y="79" fill="#61756a" fontSize="11" textAnchor="middle">
        sealed volumes
      </text>

      <rect x="560" y="38" width="140" height="54" rx="8" fill="#111815" stroke="#2c3d34" />
      <text x="630" y="61" fill="#e8f0ea" fontSize="13" textAnchor="middle">
        claims
      </text>
      <text x="630" y="79" fill="#61756a" fontSize="11" textAnchor="middle">
        ≥ N t, attested
      </text>

      <rect x="0" y="138" width="720" height="112" rx="10" fill="#0c1f14" stroke="#22795180" />
      <text x="16" y="162" fill="#4ade80" fontSize="11" letterSpacing="1.2">
        NEVER LEAVES THE CLIENT
      </text>

      <rect x="20" y="176" width="150" height="54" rx="8" fill="#0a0f0d" stroke="#22795180" />
      <text x="95" y="199" fill="#e8f0ea" fontSize="13" textAnchor="middle">
        serial, tonnes
      </text>
      <text x="95" y="217" fill="#61756a" fontSize="11" textAnchor="middle">
        the credit itself
      </text>

      <rect x="200" y="176" width="150" height="54" rx="8" fill="#0a0f0d" stroke="#22795180" />
      <text x="275" y="199" fill="#e8f0ea" fontSize="13" textAnchor="middle">
        secret key
      </text>
      <text x="275" y="217" fill="#61756a" fontSize="11" textAnchor="middle">
        identity + nullifier
      </text>

      <rect x="380" y="176" width="150" height="54" rx="8" fill="#0a0f0d" stroke="#22795180" />
      <text x="455" y="199" fill="#e8f0ea" fontSize="13" textAnchor="middle">
        true total
      </text>
      <text x="455" y="217" fill="#61756a" fontSize="11" textAnchor="middle">
        proved, not shown
      </text>

      <rect x="560" y="176" width="140" height="54" rx="8" fill="#0a0f0d" stroke="#22795180" />
      <text x="630" y="199" fill="#e8f0ea" fontSize="13" textAnchor="middle">
        openings
      </text>
      <text x="630" y="217" fill="#61756a" fontSize="11" textAnchor="middle">
        auditor only
      </text>

      <line x1="95" y1="176" x2="95" y2="96" stroke="#4ade80" strokeWidth="1.5" markerEnd="url(#arrow)" opacity="0.6" />
      <line x1="275" y1="176" x2="275" y2="96" stroke="#4ade80" strokeWidth="1.5" markerEnd="url(#arrow)" opacity="0.6" />
      <line x1="455" y1="176" x2="455" y2="96" stroke="#4ade80" strokeWidth="1.5" markerEnd="url(#arrow)" opacity="0.6" />
      <line x1="630" y1="176" x2="630" y2="96" stroke="#4ade80" strokeWidth="1.5" markerEnd="url(#arrow)" opacity="0.6" />
    </svg>
  );
}
