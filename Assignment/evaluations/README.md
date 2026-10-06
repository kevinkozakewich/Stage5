# Evaluation evidence

`historical/` preserves the previously saved hosted-subagent packets, raw outputs, original results, prompt snapshots, test fixtures, and assertion implementations. The provider was recorded as `cursor:subagent`. Original records do not identify a verified model or response ID or contain measured token/cost usage. The files are evidence of saved outputs with limited provenance; copying them does not create new inference evidence.

From `Assignment/`, run `node evaluations/replay-historical.js`. This replays all 34 S1–S4 saved outputs against their archived named assertions and four limited Stage 5 smoke checks. It does not call a model. Add `--write-results` to save the structured replay results. The archived implementations retain their original limitations, and are separate from runtime guardrails.

The packaged replay needs only Node.js. `historical/test-contexts.json` contains the original YAML test variables normalized into JSON, with the source file SHA-256 beside each entry. Replay rejects a snapshot if its original YAML bytes change. The raw YAML remains included for inspection.

- S1–S4 each have three named, reproducible checks with per-fixture outcomes.
- W5 has two original examples checking expected challenge and basic JSON shape. These do not demonstrate adversarial coverage of every sub-agent output.
- W6 has one example. The original scorer checks formatting and two phrases; it does not substantiate full artifact coverage or the absence of unsupported claims. It allows four paragraphs where the prompt requested three.
- The coordinator has one saved next-tool example. It does not demonstrate a full coordinator execution, error recovery, or human checkpoint enforcement.
- `historical/legacy-metrics/` preserves the old golden metrics verbatim. Its apparent September trend dates were labels generated during an October run, not measured historical runs. Do not use those labels as dated measurement evidence.

`historical-replay-results.json` records deterministic checks of these exact saved artifacts. These limitations apply to the historical archive, not to the fresh evidence described below.

## Current Stage 5 evidence

`stage5/results.json` records 22 actual first-attempt native model cases: 12 W5 reviews, four W6 syntheses and six coordinator decisions. A separate blind semantic judge checked all 16 W5/W6 outputs. Raw responses, exact packets, native response IDs, model identity, measured token usage and independently replayable assertions are included. `stage5/scorer-adjustments.json` retains one lexical assertion false negative and its justified correction; no model output was edited or retried.

`stage5/governed/native-governed-2026-10-05-02/` preserves the 17-call end-to-end application evaluation. A real coordinator selected each dispatch, all four emitted producing artifacts were reviewed independently, a structured dispatch error was corrected autonomously, and the run stopped at `pending_human`. Requests, responses, audit records, immutable artifacts and the loaded harness source are archived. The earlier `-01` run retains an integration error where the driver omitted the model field from its usage envelope; it is not counted as a successful run or silently erased.

Native inference is invoked only inside `evaluations/`, the certification's explicit CLI exemption. The application runtime itself accepts callbacks or JSONL responses and never invokes a CLI. The native host's billed USD is not exposed; records retain that fact and a separately labelled Standard credit-equivalent estimate derived from measured tokens. Current terminal-FAIL handling and frozen session-source binding were added after the archived run and are covered by explicit regression tests; the archived run is not misrepresented as exercising that later extension.

Original Stage 5 scorer source is retained under `historical/original-scorers/` for inspection. Its original relative paths assumed the development checkout; use `replay-historical.js` for the self-contained packaged replay.
