# Evaluation evidence

`historical/` preserves the previously saved hosted-subagent packets, raw outputs, original results, prompt snapshots, test fixtures, and assertion implementations. The provider was recorded as `cursor:subagent`. Original records do not identify a verified model or response ID or contain measured token/cost usage. The files are evidence of saved outputs with limited provenance; copying them does not create new inference evidence.

From `Assignment/`, run `node evaluations/replay-historical.js`. This replays all 34 S1–S4 saved outputs against their archived named assertions and four limited Stage 5 smoke checks. It does not call a model. Add `--write-results` to save the structured replay results. The archived implementations retain their original limitations, and are separate from runtime guardrails.

- S1–S4 each have three named, reproducible checks with per-fixture outcomes.
- W5 has two original examples checking expected challenge and basic JSON shape. These do not demonstrate adversarial coverage of every sub-agent output.
- W6 has one example. The original scorer checks formatting and two phrases; it does not substantiate full artifact coverage or the absence of unsupported claims. It allows four paragraphs where the prompt requested three.
- The coordinator has one saved next-tool example. It does not demonstrate a full coordinator execution, error recovery, or human checkpoint enforcement.
- `historical/legacy-metrics/` preserves the old golden metrics verbatim. Its apparent September trend dates were labels generated during an October run, not measured historical runs. Do not use those labels as dated measurement evidence.

`historical-replay-results.json` records deterministic checks of these exact saved artifacts. Regression success does not establish certification readiness. Current runtime governance and missing workflow criteria still need evidence from actual hosted-subagent or model execution; the framework does not require a particular inference vendor.

Original Stage 5 scorer source is retained under `historical/original-scorers/` for inspection. Its original relative paths assumed the development checkout; use `replay-historical.js` for the self-contained packaged replay.
