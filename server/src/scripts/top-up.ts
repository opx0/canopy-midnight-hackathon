import { environment } from "../config.js";

// Ask the public faucet for more tNIGHT. Worth doing even when the wallet already has
// some: DUST regeneration scales with registered NIGHT, and one UTxO makes the fee
// budget a single point of failure for every write the site makes.
//
// The faucets are behind Cloudflare Turnstile. Pass the token from a browser session
// as TURNSTILE_TOKEN if you have one; without it this will almost certainly be
// refused, and the refusal is the answer — go and click the captcha.

const address = process.argv[2];
const faucet = environment.faucet;

if (!address || !faucet) {
  console.error(
    "usage: npm run top-up --workspace @canopy/server -- <mn_addr_...>\n" +
      "the address is printed as 'fee wallet address' when the server starts.\n" +
      "CANOPY_NETWORK must name a network that has a faucet.",
  );
  process.exit(1);
}

const health = async (): Promise<boolean> => {
  const response = await fetch(new URL("/api/health", faucet), {
    signal: AbortSignal.timeout(10_000),
  }).catch(() => undefined);
  const body = await response?.text().catch(() => "");
  console.log(`faucet health: ${response?.status ?? "unreachable"} ${body ?? ""}`);
  return response?.ok === true;
};

const request = async (): Promise<void> => {
  const response = await fetch(faucet, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-turnstile-token": process.env.TURNSTILE_TOKEN ?? "",
    },
    body: JSON.stringify({ recipientAddress: address, amount: "1000" }),
    signal: AbortSignal.timeout(30_000),
  });
  console.log(`faucet answered ${response.status}: ${await response.text()}`);
};

if (!(await health())) {
  console.error(
    "the faucet is not serving. This is common; it was returning " +
      "NOT_SERVING behind a green captcha for most of this build. Try later.",
  );
  process.exit(2);
}

await request();
