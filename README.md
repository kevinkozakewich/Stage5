# Level 5 certification

This submission implements the criteria in `Instructions.txt` and `What We Examine.txt`: a dispatch-only LLM coordinator, scoped workers, independent review of every producing output, deterministic boundaries and headings, persisted usage audit, and explicit human checkpoints.

## Verify

Run from this directory:

```powershell
npm test
npm run eval:stage5
npm run delegation:batch
npm run package:zip
npm run validate:submission
npm run validate:readiness
```

The strict readiness command computes its result from archived evidence and current checks. It does not assume readiness from a checklist or fixture pass.

The custom harness in `Assignment/harness/lib/governedDelegation.js` accepts inference callbacks or a JSONL bridge. The native evaluation transport stays in `Assignment/evaluations/stage5/`, where CLI inference is explicitly exempted by the certification. No API vendor or key is imposed.

See `EXAMINER_CHECKLIST.md` for criterion mapping, `Assignment/README.md` for architecture and operator instructions, and `SUBMIT.md` for the ZIP handoff. The governed evaluation correctly waits for a human substance/deployment decision; completing the certification package does not grant approval to its SQL output.

