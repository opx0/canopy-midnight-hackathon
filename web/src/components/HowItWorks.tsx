import type { Meta } from "../api.js";

export default function HowItWorks({ meta }: { meta?: Meta }) {
  return (
    <>
      <p className="lede">
        Canopy is one Compact contract. Three mechanisms do all the work, and
        each one exists to make a specific kind of lie impossible.
      </p>

      <Diagram />

      <div className="card">
        <h3>1 · A credit is a commitment</h3>
        <pre className="code-block">
          commitment = hash(serial ‖ tonnes ‖ ownerKey ‖ salt)
        </pre>
        <p style={{ fontSize: 14.5 }}>
          The registry inserts this into a public Merkle tree. Anyone can audit
          how much supply exists; nobody can see who holds a given credit or how
          large it is. Retiring requires a membership proof, so a credit the
          registry never issued cannot be spent — that is the forged-credit
          attack closed.
        </p>
      </div>

      <div className="card">
        <h3>2 · Retirement publishes a nullifier, not a serial</h3>
        <pre className="code-block">
          nullifier = hash("canopy:retire:" ‖ serial ‖ ownerSecretKey)
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
        trusted keys, as they are in the real market. Secondary trading is not
        modelled. And while volumes stay private, an observer can still count
        how many retirement transactions a company made.
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
        retired, exactly once
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
