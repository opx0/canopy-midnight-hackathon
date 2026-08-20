import { useEffect, useRef, useState } from "react";
import { count } from "../format.js";

// A number that moves when it changes. On a page whose whole claim is "this is live",
// a counter that silently jumps from 6 to 7 is a missed opportunity — and one that
// counts is how a reader notices something happened on the chain.

const still = () =>
  typeof matchMedia === "function" &&
  matchMedia("(prefers-reduced-motion: reduce)").matches;

export default function Num({ value }: { value: number | string }) {
  const target = Number(value);
  const [shown, setShown] = useState(target);
  const from = useRef(target);

  useEffect(() => {
    if (!Number.isFinite(target) || from.current === target) return;
    // Only worth animating a change somebody can follow. A first paint, or a jump of
    // a hundred thousand, is just a number.
    const start = from.current;
    from.current = target;
    if (still() || Math.abs(target - start) > 5_000) {
      setShown(target);
      return;
    }
    const began = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const done = Math.min(1, (now - began) / 900);
      const eased = 1 - (1 - done) ** 3;
      setShown(Math.round(start + (target - start) * eased));
      if (done < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target]);

  return <>{Number.isFinite(shown) ? count(shown) : String(value)}</>;
}
