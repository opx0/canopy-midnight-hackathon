import type { History, Meta, ChainView, Status } from "../api.js";

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

const since = (at?: number) => {
  if (!at) return "just now";
  const hours = (Date.now() - at) / 3_600_000;
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} min`;
  if (hours < 48) return `${Math.round(hours)} h`;
  return `${Math.round(hours / 24)} days`;
};

export default function Live({
  history,
  chain,
  meta,
  status,
}: {
  history?: History;
  chain?: ChainView;
  meta?: Meta;
  status?: Status;
}) {
  const figures = [
    {
      value: history ? history.transactions.toLocaleString() : "—",
      label: `real transactions in ${since(history?.since)}`,
    },
    {
      value: history?.medianMs ? seconds(history.medianMs) : "—",
      label: "median prove and confirm",
    },
    {
      value: chain ? Number(chain.issuedTonnes).toLocaleString() : "—",
      label: "tonnes issued, publicly",
    },
    {
      value: chain ? chain.retirementEvents.toLocaleString() : "—",
      label: "retirements, tonnage hidden",
    },
    {
      value: history ? history.rejections.toLocaleString() : "—",
      label: "fraud attempts refused",
    },
  ];

  return (
    <section className="live-strip">
      <div className="live-head">
        <span className={`pill${status?.ready ? " live" : ""}`}>
          <span className={`dot${status?.ready ? " pulse" : ""}`} />
          {status?.ready ? "live" : "arming"}
        </span>
        <span className="live-where">
          Midnight {meta?.network ?? "PreProd"} · contract
        </span>
        <code className="live-address">{meta?.contractAddress ?? "…"}</code>
      </div>

      <div className="live-figures">
        {figures.map((figure) => (
          <div key={figure.label} className="live-figure">
            <div className="live-value">{figure.value}</div>
            <div className="live-label">{figure.label}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
