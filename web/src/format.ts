export const hash = (value: string) =>
  value.length > 22 ? `${value.slice(0, 12)}…${value.slice(-8)}` : value;

// Pin the locale. The server renders for judges anywhere, and a browser set to en-IN
// turns 200,000 into 2,00,000, which reads as a typo rather than as a number.
export const count = (value: string | number) =>
  Number(value).toLocaleString("en-US");

export const tonnes = count;

export const seeded = (session?: { seeding: { done: number; total: number } }) =>
  !!session && session.seeding.done >= session.seeding.total;
