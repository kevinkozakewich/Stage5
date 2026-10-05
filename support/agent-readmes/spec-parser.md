# S1 Spec Parser — Phase 1

Prompt and evals for migration brief → `requirements.json`.

| Asset | Path |
|---|---|
| Prompt | `prompt/Prompt.md` |
| Golden eval | `evals/promptfooconfig.golden.yaml` |
| Live eval | `evals/promptfooconfig.yaml` |
| Fixtures | `evals/tests/` (8 briefs) |
| Assertions | `evals/assertions/specParser.cjs` |

Run offline eval:

```powershell
npm run eval:s1
```

Metrics: `schema_compliance`, `field_completeness`, `pk_extraction` (target ≥95% composite).
