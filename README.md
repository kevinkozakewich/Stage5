# Level 5 certification

This repository is checked against `Instructions.txt` and `What We Examine.txt`.

**Readiness: not yet fully established.** The deterministic guardrails, human checkpoints, audit persistence, source history, and archived evaluation assertions can be verified locally. The remaining evidence needed is listed in `EXAMINER_CHECKLIST.md`. A passing structural validator is not certification sign-off.

## Verify

From this directory, run:

```powershell
npm test
npm run delegation:batch
npm run eval:subagent:all
npm run package:zip
npm run validate:submission
npm run validate:readiness
```

The strict readiness command exits nonzero while mandatory evidence remains unverified. `npm run delegation:golden` replays fixtures and correctly stops with exit code 2 at the human checkpoint; it does not grant human approval.

## Inference and scope

The certification requires an LLM coordinator with dispatch tools only, scoped workers, separate adversarial contexts, and a custom harness. It does not name a required API vendor or require an API key as an artifact. Native hosted subagent orchestration can be used if its actual tool scope, governance, boundary validation, and per-step telemetry are demonstrated. CLI inference inside evaluations is explicitly permitted.

The included `run-delegation.js` is a golden regression runner. The saved hosted subagent samples are separate evaluation evidence. Neither a deterministic routing oracle nor a declared tool manifest alone demonstrates a complete hosted coordinator run.

Submission instructions: `SUBMIT.md`. Criterion mapping: `EXAMINER_CHECKLIST.md`.
