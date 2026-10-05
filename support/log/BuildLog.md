Build log
Downstream migration trigger delivery pipeline. Four agents, four guardrails, one human punch-out. Built after Level 3 passed.

Phase 0: Scaffold
2026-09-14. Level 3 was at 100% on golden harness, so I copied S3 Trigger Review into agents/trigger-review/ and did not touch the prompt. Started with folder layout from Proposal.md and a stub WorkflowDefinition — knowing I'd fill that in once the harness actually ran.

Phase 1: New agents (S1, S2, S4)
2026-09-14.
S1 Spec Parser — migration brief to requirements.json. Eight brief fixtures. The model kept putting schema prefixes on table names until FIELD RULES spelled out "unqualified table name only."
S2 Trigger Codegen — requirements to trigger.sql. Eight fixtures covering IUD, composite PK, insert-only. Same contract as Level 3: prep SP, dynamic enqueue, no direct queue INSERT. Golden provider first, same pattern as Level 3.
S4 Remediator — only runs on FAIL branch. Eight (sql, review) pairs from Level 3 defect patterns. Had to constrain it to apply fixes from the violation list only — early drafts rewrote the whole trigger and broke passing elements.

All three hit 100% on golden evals before I wired the workflow.

Phase 2: Orchestrator
2026-09-14.
Router in harness/lib/router.js — state machine, not an LLM. W1–W4 tests in workflow/evals/routing.test.js. The tricky part was getting PASS/FAIL/MAX_RETRIES and the remediate loop counter right without off-by-one errors. 16 routing tests, all deterministic.

Phase 3: Guardrails between steps
2026-09-14.
G1 JSON schema after S1 — catches missing pk or trigger_type before codegen wastes tokens.
G2 SQL sentinel after S2 — direct queue INSERT, missing SET NOCOUNT ON, missing prep SP. Pulled defect patterns straight from Level 3 fixtures.
G3 adversarial review after S3 — challenges PASS verdicts. Supplements G2/G4, does not replace them.
G4 cross-check — review.json says forbidden_patterns.clean but G2 found dirt. Caught the "false PASS on paper" case.

12 guardrail unit tests. Guardrails only run between steps — nothing embedded inside agent prompts.

Phase 4: Punch-out
2026-09-14.
P1 stops the workflow after technical PASS. Human creates .human-approved in the run directory. Deployment is not an AI decision.

Bypass testing:
- Test A: --force-complete → BYPASS_BLOCKED, exit 1. Good.
- Test B: sentinel created before S3 finished → PREMATURE_APPROVAL. Needed an mtime guard — empty file presence alone was not enough.
- Test C: normal flow pauses at pending_human (exit 2), completes after approval (exit 0).

Phase 5: Audit trail
2026-09-14.
JSONL per step in audit/{run_id}.jsonl. Agent lines get model, input_tokens, output_tokens, cost_usd. Wrote ExampleFailureTrace.md for fixture-03 — G2 blocks a direct queue INSERT from S2, S3 never runs. That separation (guardrail fail vs punch-out) is the whole point.

Phase 6: E2E measurement
2026-09-14.
Eight fixtures: clean pass, remediate loop, guardrail fail, composite PK, insert-only, G1 schema fail, G4 mismatch, retries exhausted. batch-run.js × 3 dated batches → 24 runs, 100% E2E on expected outcomes. Headline number is full workflow, not per-step.

Closure
2026-09-14. validate:submission → 30/30 PASS. Zip at submission/level-4-certification.zip. WorkflowDefinition.md filled in last — it was a placeholder until the harness proved the diagram matched reality.

Phase 7: Live API calibration
2026-09-15.
Golden harness was 100% offline but had never hit the real API. Two bugs surfaced immediately:

1. ESM package.json broke S3 assertions — triggerReview.js uses module.exports; under "type":"module" exports were empty. Fixed by copying to triggerReview.cjs and pointing promptfooconfig at .cjs files.
2. S3 prompt/assertions were stale vs Level 3 — synced Prompt.md, tests, and assertions from the passing Level 3 submission.

Live streak (gpt-4o, 10 consecutive runs):
- S1 Spec Parser: 10/10 (343s, eval-concurrency 8)
- S2 Trigger Codegen: 10/10 (444s)
- S3 Trigger Review: 10/10 after insert-only @Source prompt tweak (was 9/10 on one flaky run)
- S4 Remediator: 10/10 (331s)

Parallelization: running multiple full promptfoo evals in parallel (5×) hammered the API — RateLimitExhaustedError, not model quality failures. Streak script now runs iterations sequentially with --max-concurrency 8 inside each eval (~33s/run vs ~90s sequential tests). "all" mode runs agents one after another to stay under rate limits.
