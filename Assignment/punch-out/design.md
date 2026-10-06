# Human checkpoints

The delegation runner stops before final disposition. A successful automated review is not a human deployment approval.

After validated W1/W2/W3/W5/W6 outputs and deterministic report assembly, the run records `examination.json` with the correlation ID, creation time, and hashes of the report and examined artifacts. Revisions require new review and new approval.

## Substance

The harness reads the workflow manifests. Any toy workflow or at least two peripheral workflows requires a human Continue/Reject decision. The current W5/W6 assessment therefore elevates.

`harness/record-substance-decision.js` records the human reviewer, decision, timestamp, report hash, and verbatim report in append-only JSONL. A CLI boolean cannot approve the gate. A later valid Reject overrides an earlier Continue. The historical example row naming certification-harness is not a valid current decision.

## Deployment

`harness/record-deployment-decision.js` requires an explicit human name and Approve/Reject decision for an existing, unchanged examination. It records a JSON `.human-approved` decision and retains the report with the decision. An empty sentinel or `--human-approved` flag is insufficient. The command does not execute SQL.

`harness/finalize-delegation.js` resumes the checkpoint without re-running agents. It checks both decisions, correlation ID, artifact/report hashes, and deployment approval time. Missing decisions leave `pending_human`; rejection prevents success. No coordinator tool exposes these operator commands.

See `README.md` for command syntax. Relevant regression tests are under `coordinator/evals/human-checkpoint.test.js`, `coordinator/evals/delegation-boundaries.test.js`, and `guardrails/tests/delegation-boundaries.test.js`.

The inherited Level 4 `run-workflow.js` and `punch-out/bypass-tests.md` are legacy fixture regressions, not the Stage 5 approval interface.
