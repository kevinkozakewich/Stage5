# Example delegation examination trace

**Correlation ID:** `2026-10-05-delegation-v1-fixture-01-clean`  
**Fixture:** `golden-pass` via `harness/run-delegation.js`  
**Outcome:** SUCCESS after P1 human approval and substance Continue

## Narrative

1. **Coordinator** dispatches `launch_spec_parser` → W1 writes `requirements.json`; **G1** validates schema at delegation boundary.
2. Coordinator dispatches `launch_trigger_codegen` → W2 writes `trigger.sql`; **G2** boundary check (fixture-golden pass).
3. Coordinator dispatches `launch_trigger_review` → W3 `review.json` with `verdict=PASS`.
4. Coordinator dispatches `launch_adversarial_reviewer` → W5 fresh isolated session (`isolated_session_id` in audit `detail`); **UPHELD**; **G4** cross-check at boundary.
5. Coordinator dispatches `launch_delivery_report_writer` → W6 body; harness assembles deterministic PASS/FAIL headings into `delivery-report.md`.
6. **Substance gate** satisfied via `--substance-continue` or matching row in `delegation/substance-overrides.jsonl`.
7. **P1** records `.human-approved`; run status `success`.

## Token / cost

See JSONL sample `audit/samples/delegation-examination-success.jsonl` — every coordinator and sub-agent line includes `model`, `input_tokens`, `output_tokens`, and `cost_usd`.

## Failure example

Guardrail halt at G1 on `golden-guardrail-halt` remains documented in `audit/trace-g2-halt-example.md` (Level 4 lineage) and `audit/samples/g2-halt-failure.jsonl`.
