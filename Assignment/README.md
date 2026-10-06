# Level 5 submission

Delegated SQL Server migration-trigger delivery with a dispatch-only LLM coordinator, scoped workers, independent review, and human checkpoints. The source and evidence map to the supplied Stage 5 instructions; no particular API vendor or API key is required.

## Verify the submission

Node.js runs the packaged checks without installing dependencies:

```powershell
npm test
npm run validate
npm run eval:historical
npm run eval:stage5
npm run delegation:batch
```

The readiness checker inspects the archived responses, provenance, governance trace, and boundary enforcement. Missing or altered evidence fails the check. Golden routing tests remain explicitly simulated and do not stand in for model evaluation.

## Application runtime

`harness/lib/governedDelegation.js` is the custom provider-neutral application harness. `createGovernedSession()` exposes `nextRequest()` and `submitResponse()`; `runGovernedDelegation()` accepts inference callbacks. `harness/run-governed.js` exposes the same contract over JSON lines. It never launches a model CLI or shell.

Each coordinator request exposes exactly six purpose-built launch tools. The model returns `{name, arguments, disposition}`; the harness enforces the declared argument schema and executes only the corresponding workflow. It never chooses the coordinator's next workflow. Each worker receives its own prompt and assigned sources. W5 alone has `read_file`, limited to assigned immutable source artifacts and checked against their hashes and resolved paths. Other workers have no application tools.

Worker output passes deterministic validation before becoming coordinator context. Invalid output is retained in the audit, while the coordinator receives a structured error. Accepted versions are immutable; a revision invalidates dependent reviews. Every producing output, including W6 prose, requires an independent W5 review. The writer receives the complete moderated evidence and dispositions; the harness derives PASS/FAIL headings.

Adversarial findings also create an outstanding response obligation, including additional findings that preserve an existing FAIL. SQL/examiner findings require targeted W3 re-examination with the original canonical challenge context and then independent W5 review of that response. W1/W6 findings require their own scoped producer and independent review. A repair cannot erase the original challenge, a historical examination cannot approve current revised SQL, and neither PASS nor terminal FAIL may bypass the required cycle.

An inference adapter must honor the request's application tools and separate review context. It returns the exact output plus provider-reported model, measured input/output tokens, and cost provenance. The included evaluation adapter exercises this interface using fresh signed-in native sessions only under `evaluations/`, where the certification explicitly permits CLI inference. The broader evaluation host is not claimed as a production sandbox. Its archived event records establish whether any host tool was used.

## Evidence and telemetry

- `coordinator/`, `workflows/`, `agents/`: declarations, prompts, named criteria and measured results.
- `guardrails/` and `coordinator/evals/`: boundary, governance, scope, report and checkpoint regressions.
- `evaluations/historical/`: original 34 S1–S4 outputs with archived assertions and documented provenance limits.
- `evaluations/stage5/`: fresh W5, W6 and coordinator evaluations, exact packets/responses, independent semantic judgments, measured tokens and model identities, and replay scorers.
- `evaluations/stage5/recheck/`: additional measured challenge/re-examination cycles and terminal FAIL synthesis. Its source manifests distinguish the original verdict-overturn fix from the later added-findings extension; the earlier results are not relabelled as executions of later code. The prior source copy was recovered after the calls and verified against the hashes recorded before inference, as its provenance file explains. Original packets and raw responses remain unchanged.
- `evaluations/stage5/governed/`: native-model application trace and retained earlier integration failure. Raw responses are never manually corrected.
- `repository/` and `package-integrity.json`: meaningful Git history and every packaged file's SHA-256.

Native session records expose model identity and response-level input, cached-input and output tokens. They do not expose billed USD. Audit records preserve `cost_usd: null`, the reason, and a separately labelled Standard credit equivalent computed from documented model rates. That equivalent is an estimate of cost in credits, not actual charged credits, a subscription allowance, or an invented dollar bill. Audit entries persist correlation IDs, response IDs, hashes and model usage for every inference step, including failed outputs.

## Human checkpoints

The governed evaluation must end at `pending_human`: W5 and W6 are assessed as peripheral, so the substance gate elevates. This is the required routing behavior. No model or command-line flag grants human approval.

A human reviews the exact report and artifacts, then records a decision using these separate operator commands (replace the placeholders). They are absent from coordinator tools:

```powershell
node harness/record-substance-decision.js --correlation-id RUN_ID --decision Continue --reviewer "Human reviewer" --report "artifacts/RUN_ID/delivery-report.md"
node harness/record-deployment-decision.js --run-dir "artifacts/RUN_ID" --reviewer "Human reviewer" --decision Approve
node harness/finalize-delegation.js --run-dir "artifacts/RUN_ID"
```

Substance accepts Continue/Reject; deployment accepts Approve/Reject. Records append the report verbatim, its hash, identified reviewer and decision. Finalization checks unchanged artifacts and decision timing and honors rejection. No SQL is deployed by these commands. Certification examination and approval of a generated SQL delivery are separate decisions.

