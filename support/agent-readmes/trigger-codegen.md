# S2 Trigger Codegen — Phase 1

Prompt and evals for `requirements.json` → `trigger.sql`.

| Asset | Path |
|---|---|
| Prompt | `prompt/Prompt.md` |
| Golden eval | `evals/promptfooconfig.golden.yaml` |
| Live eval | `evals/promptfooconfig.yaml` |
| Fixtures | `evals/tests/` (8 requirement JSONs) |
| Assertions | `evals/assertions/triggerCodegen.cjs` |

Run offline eval:

```powershell
npm run eval:s2
```

Metrics: `structural_contract`, `dynamic_enqueue`, `forbidden_patterns` (target ≥95% composite).
