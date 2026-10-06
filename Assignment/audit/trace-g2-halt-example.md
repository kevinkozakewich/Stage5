# Trace example: G2 blocks a bad trigger

Artifact 5 walkthrough. Fixture `fixture-03-guardrail-fail`.

S2 emitted a direct `INSERT INTO DownstreamMigrationQueue` without going through the prep SP. G2 caught it before S3 ran. You can follow this without executing the harness.

## Input

**Fixture:** `fixture-03-guardrail-fail`  
**Brief:** `fixtures/fixture-03-guardrail-fail/brief.md`  
**Expected:** automated failure at G2, origin step S2

S1 parsed the brief fine. S2 codegen returned SQL with the same defect pattern as the Level 3 missing-source fixture.

## Run metadata

| Field | Value |
|---|---|
| `run_id` | `2026-09-14T14:22:08Z-fixture-03` |
| `fixture_id` | `fixture-03-guardrail-fail` |
| `final_run_status` | `FAILED` |
| `failure_origin_step` | `G2` (originating agent `S2`) |
| `remediate_cycles` | 0 |
| `human_involved` | No |

This is an automated halt, not punch-out.

## JSONL excerpt

Sample log: `audit/samples/g2-halt-failure.jsonl`

Typical sequence:

| seq | step | type | status | note |
|---|---|---|---|---|
| 1 | S1 | agent | success | requirements.json written |
| 2 | G1 | guardrail | success | schema OK |
| 3 | S2 | agent | success | trigger.sql written |
| 4 | G2 | guardrail | failed | direct queue INSERT detected |
| 5 | O | routing | halted | S3 never invoked |

## What to look for

- `failure_origin_step` points at G2 with originating agent S2
- No S3 or S4 lines appear after the G2 failure
- Token and cost fields on agent lines match `audit/schema.json`

## Punch-out contrast

A `pending_human` run stops after S3 PASS with exit 2. This run failed at G2 with exit 1 and never reached review. See `punch-out/design.md` for the full comparison table.
