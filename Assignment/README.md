# Level 5 submission

Delegated downstream migration trigger delivery system.

**Status: structural checks available; full certification readiness not yet established.**

## Local verification

Node.js runs the deterministic checks without installing additional dependencies:

```powershell
npm test
npm run validate
npm run delegation:batch
npm run eval:historical
```

`npm run delegation:golden` writes a report and stops at `pending_human` with exit code 2. The default run uses simulated fixtures. It never represents fixture token/cost estimates as observed model usage, and `--mode live` is rejected because this runner does not implement a live transport.

## Evidence map

- `coordinator/`: dispatch-only tool declaration, prompt, and routing/boundary evaluations.
- `workflows/`: W1-W6 tool, context, artifact, and substance manifests.
- `agents/`: prompts and named evaluation criteria.
- `guardrails/`: actual requirements, SQL, review, and adversarial validators.
- `evaluations/`: self-contained historical raw responses, packets, assertions, limitations, and deterministic replay results.
- `metrics/`: current golden fixture regression outcomes, explicitly separate from delivered success.
- `audit/`: schema and historical samples. Current runs persist under the sibling `audit-runs/` directory.
- `repository/`: exported Git history included by packaging.

## Human checkpoints

No flag grants substance or deployment approval. A human reviews the generated report and artifacts, then explicitly records a decision. Replace placeholders with the actual run and reviewer; these are operator commands, absent from coordinator tools.

```powershell
node harness/record-substance-decision.js --correlation-id RUN_ID --decision Continue --reviewer "Human reviewer" --report "artifacts/RUN_ID/delivery-report.md"
node harness/record-deployment-decision.js --run-dir "artifacts/RUN_ID" --reviewer "Human reviewer" --decision Approve
node harness/finalize-delegation.js --run-dir "artifacts/RUN_ID"
```

Substance accepts Continue or Reject; deployment accepts Approve or Reject. Substance records append the report verbatim, its hash, the reviewer, and decision. Finalization checks the unchanged report and all examined artifacts and honors rejection. No SQL is deployed by these commands.

## Remaining verification

The instructions allow native hosted subagents; no particular API vendor is mandatory. The existing saved samples do not demonstrate a complete execution in which an LLM coordinator holds only dispatch tools, each worker output is adversarially reviewed in isolation, and actual per-step model/token/cost data persists. The W6 and coordinator sample assertions also do not substantiate every named semantic criterion or establish freedom from regular manual correction.

These are evidence gaps, not proof that hosted subagents are disallowed. Golden tests measure harness behavior, not LLM governance or runtime model quality. No approval is inferred from a passing test.
