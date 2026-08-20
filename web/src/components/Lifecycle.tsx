// The whole protocol in one picture. A reader who never gets past this should still
// leave knowing what Canopy does: five moves, each writing one opaque thing to a
// public chain, and a list of what never goes with them.

const STAGES = [
  { key: "issue", who: "Registry", what: "Issues", gets: "one hash" },
  { key: "trade", who: "Holder", what: "Sells", gets: "two hashes" },
  { key: "retire", who: "Holder", what: "Retires", gets: "one hash" },
  { key: "claim", who: "Company", what: "Claims", gets: "“≥ N tonnes”" },
  { key: "attest", who: "Auditor", what: "Attests", gets: "a signature" },
] as const;

export type Stage = (typeof STAGES)[number]["key"];

const HIDDEN = [
  "who holds a credit",
  "how big it is",
  "who bought it",
  "what a company really retired",
];

export default function Lifecycle({ active }: { active?: Stage }) {
  return (
    <figure className="cycle">
      <figcaption className="cycle-band">What the chain gets</figcaption>
      <div className="cycle-track">
        {STAGES.map((stage, index) => (
          <div
            key={stage.key}
            className={`cycle-stage${active === stage.key ? " on" : ""}`}
          >
            <div className="cycle-who">{stage.who}</div>
            <div className="cycle-what">
              <span className="cycle-num">{index + 1}</span>
              {stage.what}
            </div>
            <div className="cycle-gets">{stage.gets}</div>
          </div>
        ))}
      </div>
      <div className="cycle-private">
        <span className="cycle-band private">Never leaves the company</span>
        <span className="cycle-hidden">
          {HIDDEN.map((item) => (
            <span key={item} className="cycle-chip">
              {item}
            </span>
          ))}
        </span>
      </div>
    </figure>
  );
}
