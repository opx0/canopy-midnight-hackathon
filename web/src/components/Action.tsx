import { useCallback, useEffect, useRef, useState } from "react";
import { live, runAction, type Job } from "../api.js";

export type ActionState = {
  run: (body: Record<string, unknown>) => Promise<Job | undefined>;
  busy: boolean;
  elapsed: number;
  result?: Job;
  error?: string;
};

export const useAction = (
  sessionId: string | undefined,
  onSettled?: () => void,
): ActionState => {
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [result, setResult] = useState<Job>();
  const [error, setError] = useState<string>();
  const timer = useRef<ReturnType<typeof setInterval>>(undefined);

  useEffect(() => () => clearInterval(timer.current), []);

  const run = useCallback(
    async (body: Record<string, unknown>) => {
      if (!sessionId) return undefined;
      setBusy(true);
      setError(undefined);
      setResult(undefined);
      const startedAt = Date.now();
      setElapsed(0);
      timer.current = setInterval(
        () => setElapsed(Date.now() - startedAt),
        100,
      );
      try {
        const job = await runAction(sessionId, body);
        setResult(job);
        return job;
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught));
        return undefined;
      } finally {
        clearInterval(timer.current);
        setBusy(false);
        onSettled?.();
      }
    },
    [sessionId, onSettled],
  );

  return { run, busy, elapsed, result, error };
};

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

export function ActionFeedback({
  state,
  busyLabel = "Proving and submitting to Midnight",
  doneLabel = "Confirmed on chain",
  children,
}: {
  state: ActionState;
  busyLabel?: string;
  doneLabel?: string;
  children?: React.ReactNode;
}) {
  if (state.busy) {
    // Midnight fees come out of a DUST balance that regenerates at a fixed rate, so a
    // long wait here often is not proving at all — say which one it is.
    const starved = live.fees?.waitingSince ? live.fees : undefined;
    return (
      <div className="working">
        <span className="spinner" />
        <span>
          {starved
            ? `Waiting for the fee wallet — Midnight regenerates DUST from registered NIGHT at a fixed rate, and this transaction costs more than has accrued${
                starved.secondsToAfford
                  ? `. About ${starved.secondsToAfford}s to go`
                  : ""
              }.`
            : `${busyLabel}…`}
        </span>
        <span className="elapsed">{seconds(state.elapsed)}</span>
      </div>
    );
  }
  if (state.error) {
    // Three different things can go wrong and they mean opposite things. Two are the
    // system working; the third is this deployment failing, and calling that a
    // contract rejection would take credit for a bug.
    const unprovable = /no ownership proof can be constructed/.test(state.error);
    const refused = /failed assert:/.test(state.error);
    const message = state.error.replace(/^failed assert:\s*/, "");
    return (
      <div className={`rejected${unprovable || refused ? "" : " broken"}`}>
        <div className="rejected-head">
          <span>✕</span>{" "}
          {unprovable
            ? "No valid proof exists"
            : refused
              ? "Rejected by the contract"
              : "Canopy could not submit this"}
        </div>
        <div className="rejected-msg">{message}</div>
        <div
          style={{
            fontSize: 12.5,
            color: "var(--text-faint)",
            marginTop: 10,
          }}
        >
          {unprovable
            ? "Refused before a proof could even be built — there is nothing to submit."
            : refused
              ? "Refused during local circuit execution. No transaction was submitted and nothing was spent."
              : "This is a fault in this deployment, not a decision by the contract. Nothing was spent; try it again."}
        </div>
      </div>
    );
  }
  if (state.result) {
    return (
      <div className="confirmed">
        <div className="confirmed-head">
          <span>✓</span> {doneLabel}
        </div>
        {children}
      </div>
    );
  }
  return null;
}
