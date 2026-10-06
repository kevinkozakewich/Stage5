# Punch-out bypass tests

Artifact 3 evidence. Ran 2026-09-14 against the harness in golden mode, no API key.

See `punch-out/design.md` for the P1 rules these tests exercise.

## Summary

| Test | Scenario | Expected exit | Actual exit | Result |
|---|---|---|---|---|
| A | `--force-complete` bypass attempt | 1 | 1 | Pass |
| B | `.human-approved` before S3 finishes | 1 | 1 | Pass |
| C | Normal flow with approval after PASS | 0 | 0 | Pass |

## Test A: force-complete blocked

Goal: prove `--force-complete` cannot skip P1.

```powershell
node harness/run-workflow.js `
  --fixture golden-pass `
  --run-id bypass-test-a `
  --output-dir artifacts/bypass-test-a `
  --force-complete
```

| Field | Value |
|---|---|
| Exit code | 1 |
| Final status | `bypass_blocked` |
| Audit log | `audit-runs/bypass-test-a.jsonl` |

Audit excerpt:

```json
{"run_id":"bypass-test-a","seq":10,"step_id":"P1","step_type":"punch-out","status":"bypass_blocked","detail":"BYPASS_BLOCKED","failure_origin_step":"P1"}
{"run_id":"bypass-test-a","seq":11,"step_id":"O","step_type":"routing","status":"bypass_blocked","detail":"BYPASS_BLOCKED","failure_origin_step":"P1"}
```

## Test B: premature approval rejected

Goal: `.human-approved` created before S3 completes must not count.

Setup:

```powershell
New-Item -Path artifacts/bypass-test-b/.human-approved -ItemType File -Force
```

Run:

```powershell
node harness/run-workflow.js `
  --fixture golden-pass `
  --run-id bypass-test-b `
  --output-dir artifacts/bypass-test-b
```

| Field | Value |
|---|---|
| Exit code | 1 |
| Final status | `premature_approval` |
| Audit log | `audit-runs/bypass-test-b.jsonl` |

The mtime guard rejected the sentinel because it predates S3 PASS.

## Test C: normal approval flow

### Phase 1, no sentinel

```powershell
node harness/run-workflow.js `
  --fixture golden-pass `
  --run-id bypass-test-c1 `
  --output-dir artifacts/bypass-test-c1
```

| Field | Value |
|---|---|
| Exit code | 2 |
| Final status | `pending_human` |

### Phase 2, approved

```powershell
node harness/run-workflow.js `
  --fixture golden-pass `
  --run-id bypass-test-c2 `
  --output-dir artifacts/bypass-test-c2 `
  --human-approved
```

| Field | Value |
|---|---|
| Exit code | 0 |
| Final status | `success` |

## Checklist

- [x] Test A logged `BYPASS_BLOCKED`, exit 1
- [x] Test B logged `PREMATURE_APPROVAL`, exit 1
- [x] Test C phase 1 paused at `pending_human`, exit 2
- [x] Test C phase 2 completed with `success` after approval
- [x] All three differ from automated `FAILED` runs
