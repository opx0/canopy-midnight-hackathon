import { useEffect, useRef, useState } from "react";

// The one mechanism everything else rests on, shown rather than described: real
// numbers go in, an opaque hash comes out, and the hash is what the chain keeps.
// It settles left to right on a loop, because a still hash looks like a random
// string and a settling one looks like it was derived from the row above it.

const HEX = "0123456789abcdef";
const LENGTH = 32;
const TICK = 55;

const scramble = (locked: number) =>
  Array.from({ length: LENGTH }, (_, index) =>
    index < locked
      ? SETTLED[index]
      : HEX[Math.floor(Math.random() * HEX.length)],
  ).join("");

// A fixed destination so the same hash lands every cycle — a value that changed each
// time would suggest the commitment is random rather than derived.
const SETTLED = "a3f19c72e84b0d5617fa2c9e30d41f0e".split("");

const still = () =>
  typeof matchMedia === "function" &&
  matchMedia("(prefers-reduced-motion: reduce)").matches;

// Three passes is enough to see what it is doing. After that it holds the settled
// hash, because a page somebody is reading should not be moving underneath them.
const PASSES = 3;

export default function Commit({
  serial = "4f2a…9b",
  tonnes = "600 t",
  owner = "EcoCorp",
}: {
  serial?: string;
  tonnes?: string;
  owner?: string;
}) {
  const [text, setText] = useState(SETTLED.join(""));
  const [play, setPlay] = useState(0);
  const locked = useRef(0);

  useEffect(() => {
    if (still()) return;
    locked.current = 0;
    let passes = 0;
    const timer = setInterval(() => {
      locked.current += 1;
      if (locked.current > LENGTH + 22) {
        passes += 1;
        if (passes >= PASSES) {
          setText(SETTLED.join(""));
          clearInterval(timer);
          return;
        }
        locked.current = 0;
      }
      setText(scramble(Math.min(locked.current, LENGTH)));
    }, TICK);
    return () => clearInterval(timer);
  }, [play]);

  return (
    <div
      className="commit"
      onMouseEnter={() => setPlay((n) => n + 1)}
      onClick={() => setPlay((n) => n + 1)}
    >
      <div className="commit-in">
        <span className="commit-part">{serial}</span>
        <span className="commit-part">{tonnes}</span>
        <span className="commit-part">{owner}</span>
        <span className="commit-part">salt</span>
      </div>
      <div className="commit-arrow" aria-hidden>
        <svg viewBox="0 0 12 22">
          <path
            d="M6 1v17M1.5 14.5 6 20l4.5-5.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span>hashed on the client</span>
      </div>
      <div className="commit-out" aria-label="the commitment the chain stores">
        {text}
      </div>
      <div className="commit-note">
        This is all the chain ever gets. It cannot be reversed, and without the
        salt it cannot be guessed. <span className="commit-replay">Hover to
        watch it derive again.</span>
      </div>
    </div>
  );
}
