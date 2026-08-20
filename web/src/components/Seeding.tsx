import { useEffect, useState } from "react";
import type { SessionView } from "../api.js";

// One label per completed step, so the wait names what is happening on chain rather
// than counting to four.
const STEPS = [
  "opening a registry batch",
  "issuing a 600 t credit",
  "issuing a 900 t credit",
  "registering EcoCorp",
  "registering FraudCorp",
];

export default function Seeding({ session }: { session?: SessionView }) {
  const seeding = session?.seeding;
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!seeding || seeding.done >= seeding.total) return;
    const startedAt = Date.now();
    const timer = setInterval(
      () => setElapsed(Math.round((Date.now() - startedAt) / 1000)),
      1000,
    );
    return () => clearInterval(timer);
  }, [seeding]);

  if (!seeding || seeding.done >= seeding.total) return null;
  if (seeding.failed) {
    return (
      <div className="rejected broken">
        <div className="rejected-head">
          <span>✕</span> Could not prepare your sandbox
        </div>
        <div className="rejected-msg">{seeding.failed}</div>
        <div style={{ fontSize: 12.5, color: "var(--text-faint)", marginTop: 10 }}>
          The contract itself is unaffected — everything in the chain inspector is
          still live, and How it works and What it costs do not need a sandbox.
        </div>
      </div>
    );
  }
  return (
    <div className="working">
      <span className="spinner" />
      <span>
        Giving you your own company keys on the deployed contract —{" "}
        {STEPS[seeding.done] ?? "preparing your sandbox"}. Every step is a real
        transaction, so this takes about half a minute each.
      </span>
      <span className="elapsed">
        {seeding.done}/{seeding.total} · {elapsed}s
      </span>
    </div>
  );
}
