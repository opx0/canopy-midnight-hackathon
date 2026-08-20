import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.js";
import Claim from "./components/Claim.js";
import "./styles.css";

// One extra page, so one line of routing. The server already serves index.html for
// every non-API path, which is all a permalink needs.
const claim = /^\/claim\/([0-9a-f]{64})$/.exec(location.pathname);

createRoot(document.getElementById("root")!).render(
  <StrictMode>{claim ? <Claim id={claim[1]} /> : <App />}</StrictMode>,
);
