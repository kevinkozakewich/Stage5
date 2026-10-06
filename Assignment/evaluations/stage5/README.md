# Stage 5 semantic evaluations

This suite supplements the preserved historical evidence with measured native-model evaluations of every worker-output review path (W1, W2, W3, W4 and W6) and grounded final synthesis. W5 is the independent reviewer; it does not recursively review itself.

`build-cases.js` creates 12 W5 cases and 4 W6 cases; `build-coordinator-cases.js` appends six coordinator cases. The reference expectations and exact inference packets are bound to their workflow prompts by SHA-256. Test inputs deliberately include defects; they are fixtures, never represented as generated model outputs. Packets are frozen before execution. The builder refuses to replace packets after capture.

Each actual evaluation uses a new signed-in `codex exec` session with `--sandbox read-only --json --output-last-message`, no model override, and only the blind workflow packet on stdin. This evaluation-only CLI path is explicitly exempted in `Instructions.txt`; no runtime harness imports the CLI provider. The collaboration host's four-thread limit prevented creating the planned fresh collaboration subagents, so the evaluation transport uses equivalent fresh native model sessions. No API key or endpoint was configured. Producer histories and expected results are absent from evaluator packets. Descriptive case IDs are not exposed to producers: packet filenames use opaque case numbers.

The CLI writes its exact final response to `raw/<case-id>.txt` once. JSONL events independently preserve the returned text, fresh thread ID and measured token usage. `captures.json` records actual model/response IDs, first-attempt status, zero manual corrections and packet/output hashes. Full native per-response telemetry is retained separately; tokens are never estimated from word counts or golden fixtures. Billed USD is not exposed by the native host and remains null; the separately labeled standard-credit equivalent is an estimate from measured tokens, not actual billing. Tool-free evaluation behavior is inspectable from the JSONL events.

After production, `run-semantic-review.js` uses another fresh session to review all 16 W5/W6 source/output pairs. The semantic reviewer receives blind case numbers, complete source bundles and raw outputs; no reference expectations or producer histories. It returns support, completeness, professional tone, unsupported claims and a concrete rationale per case. Its raw response and measured telemetry are retained in `semantic-review-run/`; `semantic-reviews.json` maps the blind IDs to case IDs without changing judgments. The scorer checks that mapping against the hashed raw response and rejects self-review. This full-claim check supplements deterministic reference assertions.

Run from `Assignment`:

```text
node evaluations/stage5/build-cases.js
node evaluations/stage5/build-coordinator-cases.js
node evaluations/stage5/cli-evaluation-runner.js 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22
node evaluations/stage5/run-semantic-review.js
node evaluations/stage5/score.js --write-results
```

Named W5 criteria: A1 complete output/target contract; A2 correct independent disposition; A3 detection of the seeded issue with declared source evidence; A4 independent semantic grounding and professional tone. Clean cases check false positives. Existing FAIL, partial remediation, invented findings and premature approval have explicit cases.

Named W6 criteria: R1 reference facts and human/substance punch-outs; R2 every artifact, finding and evidence reference; R3 concise heading-free prose; R4 independent semantic grounding and tone. The four cases cover a pending approval, partial repair, human substance rejection and an approved handoff that has not been deployed. R4 is mandatory because lexical reference checks cannot prove arbitrary prose contains no invented claim.

Coordinator criteria: C1 correct next workflow and immutable target/challenges; C2/C3 explained governance, checkpoint preservation and validation-error recovery; C4 one declared dispatch tool with exact schema. Six cases cover adversarial overturn, changed-SQL review, a pending-human report, malformed W3 retry, direct-tool prompt injection, and required W1 review before code generation.

`scorer-adjustments.json` retains one initial reference-assertion false negative: the substance-rejection report accurately said REJECTED and PENDING but did not use the narrow blocker synonyms accepted by the original lexical check. The revised assertion accepts those explicit source-backed states. The model response was neither edited nor regenerated, and a regression test records the correction.

Until actual responses and provenance exist, the scorer reports the case as not run and failing. A completed results file reports each case and named criterion, including failures. These evaluation invocations are evaluation-only; they do not supply a runtime inference adapter or evidence of a production deployment.
