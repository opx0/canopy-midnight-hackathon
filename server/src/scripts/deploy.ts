import { bootstrap, getContractAddress, logger } from "../chain.js";
import { networkName } from "../config.js";

const { contractAddress } = await bootstrap({ deployIfMissing: true });

logger.info(
  { network: networkName, contractAddress: getContractAddress() },
  "Canopy is deployed",
);
console.log(`\nnetwork:  ${networkName}\naddress:  ${contractAddress}\n`);
process.exit(0);
