export const hash = (value: string) =>
  value.length > 22 ? `${value.slice(0, 12)}…${value.slice(-8)}` : value;

export const tonnes = (value: string | number) =>
  Number(value).toLocaleString();

export const seeded = (session?: { seeding: { done: number; total: number } }) =>
  !!session && session.seeding.done >= session.seeding.total;
