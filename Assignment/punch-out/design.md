# Punch-out design

Artifact 3. Human sign-off before anyone treats the trigger as deploy-ready.

## Why P1 exists

The pipeline can produce SQL that passes every automated check and still should not ship without a DBA looking at it. That pause is intentional. It is not the same thing as a guardrail failure or an agent FAIL.

Guardrail and agent failures stop the run immediately with no human step. Punch-out stops a healthy run and waits.

## P1: DBA deployment approval

### When it fires

All of these must be true first:

| Check | Where |
|---|---|
| S3 returned `verdict=PASS` | `review.json` |
| G3 did not overturn the PASS | guardrail log |
| G4 passed | guardrail log |
| G2 passed on final `trigger.sql` | guardrail log |

### What happens

1. Orchestrator sets `run_status = PENDING_HUMAN`
2. Harness writes a punch-out line to the audit log (`step_id: P1`)
3. Run stops. Success is not recorded yet.
4. Operator reads `trigger.sql`, `review.json`, and the audit log
5. If deploying, operator creates `.human-approved` in the run folder:

```powershell
New-Item -Path "runs/{run_id}/.human-approved" -ItemType File -Force
```

6. Harness resumes or a second invocation with `--human-approved` completes the run

### Sentinel rules

| Rule | Behavior |
|---|---|
| Missing sentinel after PASS | Exit 2, `pending_human` |
| Valid sentinel after PASS | Exit 0, `success` |
| `--force-complete` | Exit 1, `bypass_blocked` |
| Sentinel created before S3 PASS | Exit 1, `premature_approval` |

The mtime guard on premature approval matters. An empty file alone is not enough if it was created before review finished.

## Fail vs punch-out

| Situation | Status | Human? |
|---|---|---|
| G1 or G2 blocks bad handoff | `halted` / `FAILED` | No |
| S3 FAIL, retries left | `running` through S4 loop | No |
| S3 FAIL, retries exhausted | `failure` | No |
| S3 PASS, no sentinel yet | `pending_human` | Yes, waiting |
| Bypass attempt | `bypass_blocked` | Blocked |

## Related files

| File | Contents |
|---|---|
| `punch-out/bypass-tests.md` | Tests A, B, C with commands and audit excerpts |
| `audit/trace-g2-halt-example.md` | Automated failure example, not punch-out |
