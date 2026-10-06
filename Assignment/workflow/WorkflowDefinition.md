# Workflow definition

Artifact 1. Downstream migration trigger delivery pipeline — **Stage 5 delegation map**.

**Primary runtime:** `harness/run-delegation.js` — dispatch-only **coordinator** (`coordinator/prompt/Prompt.md`, tools in `coordinator/tools/schema.json`) launches sub-workflows W1–W6.

**Regression oracle:** `harness/run-workflow.js` + `harness/lib/router.js` (Level 4 deterministic routing tests `workflow/evals/routing.test.js` W1–W4).

**Coordinator evals:** `coordinator/evals/coordinator.test.js` (C1–C4).

| Dispatch tool | Workflow | Agent folder |
|---|---|---|
| `launch_spec_parser` | W1 | `agents/spec-parser/` |
| `launch_trigger_codegen` | W2 | `agents/trigger-codegen/` |
| `launch_trigger_review` | W3 | `agents/trigger-review/` |
| `launch_remediator` | W4 | `agents/remediator/` |
| `launch_adversarial_reviewer` | W5 | `agents/adversarial-review/` (isolated context) |
| `launch_delivery_report_writer` | W6 | `agents/delivery-report/` |

## What this does

Takes a migration brief and produces contract-compliant trigger SQL. Quality gates sit between every agent step. A human sign-off at the end before anyone treats the output as deploy-ready.

Each agent is a Stage 3 prompt with its own eval suite. The orchestrator wires them together and enforces branching, guardrails, and punch-out.

S3 is reused from Level 3. Do not edit it without re-running Level 3 evals first.

Per-agent golden evals, no API key:

```powershell
npm run eval:s1
npm run eval:s2
npm run eval:s3
npm run eval:s4
```

## Agents

| Step | Agent | Folder | In | Out | Stage 3 bar |
|---|---|---|---|---|---|
| S1 | Spec Parser | `agents/spec-parser/` | brief.md | requirements.json | 95%+ schema, fields, PK |
| S2 | Trigger Codegen | `agents/trigger-codegen/` | requirements.json | trigger.sql | 95%+ structure, enqueue, forbidden |
| S3 | Trigger Review | `agents/trigger-review/` | trigger.sql | review.json | 95%+ E1, E2, E3 |
| S4 | Remediator | `agents/remediator/` | review.json + trigger.sql | revised trigger.sql | 95%+ targeted fixes |

## Pipeline

```
[Brief.md]
    ↓
  S1  Spec Parser          → requirements.json
    ↓
  G1  Schema guard         (between S1 and S2)
    ↓
  S2  Trigger Codegen      → trigger.sql
    ↓
  G2  SQL sentinel         (between S2 and S3)
    ↓
  S3  Trigger Review       → review.json
    ↓
  G3  Adversarial review   (between S3 and branch)
    ↓
  ┌───┴───┐
PASS      FAIL (retries < 2)
  │         ↓
  │       S4  Remediator   → trigger.sql (revised)
  │         ↓
  │       G2  re-scan
  │         ↓
  │       S3  re-review (loop)
  ↓
  G4  Review cross-check
    ↓
  P1  Human punch-out      (.human-approved required)
    ↓
[DONE]
```

Guardrails run between steps, not inside agent prompts.

## Handoffs

| From | To | Artifact | Guardrail |
|---|---|---|---|
| Brief | S1 | brief.md | none |
| S1 | S2 | requirements.json | G1 |
| S2 | S3 | trigger.sql | G2 |
| S3 | branch | review.json | G3 |
| S3 PASS | P1 | review.json + trigger.sql | G4 |
| S4 | S3 loop | revised trigger.sql | G2 again |

### requirements.json shape

```json
{
  "table": "BatchCampaign",
  "schema": "PurinaNA",
  "pk": "scm_id",
  "trigger_type": "AFTER INSERT, UPDATE, DELETE",
  "constraints": ["no_direct_queue_insert", "dynamic_enqueue_only"]
}
```

Composite PK uses an array, for example `["vendor_id", "contact_seq"]`.

### review.json branching

See `agents/trigger-review/prompt/Prompt.md`. Router reads `verdict`:

- PASS goes to G4 then P1
- FAIL goes to S4 if cycles remain, otherwise workflow failure

## Branching rules

Implemented in `harness/lib/router.js`, tested in `workflow/evals/routing.test.js`.

| Condition | Next | Status | Human? |
|---|---|---|---|
| G1, G2, or G4 fails | Halt | FAILED / halted | No |
| S3 FAIL, cycles left | S4 → G2 → S3 | running | No |
| S3 FAIL, cycles exhausted | Halt | failure | No |
| G3 overturns PASS | Treat as FAIL | same as S3 FAIL | No |
| S3 PASS, no sentinel | P1 wait | pending_human | Yes |
| Sentinel after PASS | Complete | success | Yes |
| `--force-complete` | Block | bypass_blocked | Blocked |

Max remediate cycles: 2 (`MAX_REMEDIATE_CYCLES` in router.js).

## Guardrails (artifact 2)

| ID | After | Type | File |
|---|---|---|---|
| G1 | S1 | Deterministic | `guardrails/validate-requirements-schema.js` |
| G2 | S2 / S4 | Sentinel | `guardrails/sql-sentinel.js` |
| G3 | S3 | Adversarial agent | `guardrails/adversarial-review/Prompt.md` |
| G4 | S3 PASS | Cross-check | `guardrails/verify-review-json.js` |

Unit tests in `guardrails/tests/`. Run with `npm run test:guardrails`.

## Punch-out (artifact 3)

P1 DBA deployment approval fires after S3 PASS and G3/G4 pass. Human creates `.human-approved` in the run output folder.

Not a failure. The SQL may be fine. Deployment is a human call.

Bypass attempts are blocked. See `punch-out/bypass-tests.md`. Design notes in `punch-out/design.md`.

## Orchestrator evals (W1 to W4)

Routing is tested without calling an LLM.

| ID | Criterion | Where |
|---|---|---|
| W1 | PASS → G4 → P1, FAIL → S4 or terminal | routing.test.js W1 block |
| W2 | Remediate loop max 2 | routing.test.js W2 block |
| W3 | Guardrail halt before next agent | routing.test.js W3 block |
| W4 | Punch-out blocks without sentinel | routing.test.js W4 block |

Bar is 95%+. Current: 29/29 via `npm test`.

## E2E success definition

A run counts as E2E success when:

1. All guardrails pass (G1 to G4 as applicable)
2. S3 returns PASS, possibly after up to 2 remediate cycles
3. Human approval recorded at P1
4. Final trigger.sql written to the run folder

Per-step agent scores are tracked separately. The certification headline is full-workflow success rate in `metrics/e2e-report.md`.

```powershell
npm run workflow:batch
npm run workflow:golden
```

## Audit trail (artifact 5)

Every step emits one JSONL line. Agent lines include model, input_tokens, output_tokens, cost_usd. Failures include failure_origin_step.

Schema: `audit/schema.json`  
Example walkthrough: `audit/trace-g2-halt-example.md`

## Agent eval map

| Agent | Metrics | Assertions |
|---|---|---|
| S1 | schema_compliance, field_completeness, pk_extraction | specParser.cjs |
| S2 | structural_contract, dynamic_enqueue, forbidden_patterns | triggerCodegen.cjs |
| S3 | command_detection, structure_checklist, forbidden_patterns | triggerReview.cjs |
| S4 | fixes_applied, forbidden_patterns, structural_contract | remediator.cjs |
| Orchestrator | W1 to W4 | routing.test.js |
