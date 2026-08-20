import { useState } from "react";

// The other half of the product. A registry that publishes claims is only useful if
// somebody on the outside can check one, so give them the box to do it in.
export default function Verify() {
  const [id, setId] = useState("");
  const valid = /^[0-9a-f]{64}$/.test(id.trim());

  return (
    <form
      className="verify-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (valid) location.href = `/claim/${id.trim()}`;
      }}
    >
      <label htmlFor="claim-id">
        <strong>Check a claim.</strong> Paste the id a company gave you and read
        it straight off the chain — no account, and nothing here to trust.
      </label>
      <div className="row">
        <input
          id="claim-id"
          className="field grow"
          placeholder="64-character claim id"
          value={id}
          spellCheck={false}
          onChange={(event) => setId(event.target.value)}
        />
        <button className="btn" type="submit" disabled={!valid}>
          Verify
        </button>
      </div>
    </form>
  );
}
