import type { History } from "../api.js";
import { count } from "../format.js";

type Series = {
  key: string;
  label: string;
  color: string;
  value: (point: History["snapshots"][number]) => number;
};

// One series per chart, three charts. Tonnes and counts live on scales three orders
// of magnitude apart, and putting them on one axis — or worse, two — would say
// something about their relationship that is not true.
const SERIES: Series[] = [
  {
    key: "tonnes",
    label: "tonnes issued",
    color: "var(--leaf)",
    value: (point) => Number(point.issuedTonnes ?? 0),
  },
  {
    key: "credits",
    label: "credits issued",
    color: "var(--sky)",
    value: (point) => point.issuedCredits ?? 0,
  },
  {
    key: "retirements",
    label: "retirements",
    color: "var(--amber)",
    value: (point) => point.retirementEvents ?? 0,
  },
];

const W = 240;
const H = 44;

function Spark({ points, color }: { points: number[]; color: string }) {
  const high = Math.max(...points);
  const low = Math.min(...points);
  const span = high - low || 1;
  const x = (index: number) =>
    points.length < 2 ? W : (index / (points.length - 1)) * W;
  const y = (value: number) => H - 3 - ((value - low) / span) * (H - 6);
  const line = points.map((value, index) => `${x(index)},${y(value)}`).join(" ");

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className="spark"
      aria-hidden
    >
      <polygon
        points={`0,${H} ${line} ${W},${H}`}
        fill={color}
        opacity="0.12"
      />
      <polyline
        points={line}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

const hours = (snapshots: History["snapshots"]) => {
  const first = snapshots[0]?.at;
  const last = snapshots[snapshots.length - 1]?.at;
  if (!first || !last || last <= first) return "";
  return `${Math.max(1, Math.round((last - first) / 3_600_000))} h`;
};

export default function Trend({ history }: { history?: History }) {
  const snapshots = history?.snapshots ?? [];
  if (snapshots.length < 3) return null;
  const window = hours(snapshots);

  return (
    <section className="trend">
      <div className="trend-head">
        The public ledger over the last {window}, sampled every 15 minutes and
        kept on disk, so a restart does not erase what happened.
      </div>
      <div className="trend-grid">
        {SERIES.map((series) => {
          const points = snapshots.map(series.value);
          const now = points[points.length - 1];
          const then = points[0];
          const moved = now - then;
          return (
            <figure
              key={series.key}
              className="trend-cell"
              title={`${series.label}: ${count(then)} → ${count(now)} over ${window}`}
            >
              <figcaption>
                <span className="trend-value">{count(now)}</span>
                <span className="trend-label">{series.label}</span>
                <span className="trend-delta">
                  {moved > 0 ? `+${count(moved)} in ${window}` : `flat over ${window}`}
                </span>
              </figcaption>
              <Spark points={points} color={series.color} />
            </figure>
          );
        })}
      </div>
    </section>
  );
}
