# Example delegation examination trace

Run `npm run delegation:golden` to produce a current fixture trace. The command returns exit 2 while human decisions are missing. Generated audit JSONL is persisted in the sibling `audit-runs/` directory under the returned run/correlation ID.

The routing oracle dispatches W1 requirements, W2 SQL, W3 review, W5 adversarial review, and W6 report body. G1, actual SQL G2, full W3/W5 shape checks, actual G4, and report-body validation run at their boundaries. A malformed output is retained in the audit but does not replace validated context.

Each invocation records its model label, token/cost fixture estimates, correlation ID, and immutable output version. `usage_source: simulated` and `execution_mode: golden` identify fixture evidence. A mock session ID does not prove actual context isolation.

The harness assembles report headings, records hashes of the report and examined artifacts, and stops for substance and deployment decisions. Flags cannot approve them. The operator commands and finalization flow are documented in `README.md`. Finalization retains the original report and rejects changed artifacts or premature approval.

The older files under `audit/samples/` are historical fixture examples retained for inspection. Their synthetic SUCCESS records, approval flags, and estimated usage are not current human decisions or measured model execution evidence. New runs use the current guardrails and append-only decision checks.
