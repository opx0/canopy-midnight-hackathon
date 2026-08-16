import type { SessionView } from "../api.js";

export default function Seeding({ session }: { session?: SessionView }) {
  const seeding = session?.seeding;
  if (!seeding || seeding.done >= seeding.total) return null;
  if (seeding.failed) {
    return (
      <div className="rejected">
        <div className="rejected-head">
          <span>✕</span> Could not prepare your sandbox
        </div>
        <div className="rejected-msg">{seeding.failed}</div>
      </div>
    );
  }
  return (
    <div className="working">
      <span className="spinner" />
      <span>
        The registry is opening a batch and issuing your credits — real
        transactions on Midnight.
      </span>
      <span className="elapsed">
        {seeding.done}/{seeding.total}
      </span>
    </div>
  );
}
