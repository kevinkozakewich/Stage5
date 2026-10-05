# S4 Remediator — Phase 1

Prompt and evals for review JSON + `trigger.sql` → revised `trigger.sql`.

| Asset | Path |
|---|---|
| Prompt | `prompt/Prompt.md` |
| Golden eval | `evals/promptfooconfig.golden.yaml` |
| Live eval | `evals/promptfooconfig.yaml` |
| Fixtures | `evals/tests/` (8 sql + review pairs) |
| Assertions | `evals/assertions/remediator.cjs` |

Run offline eval:

```powershell
npm run eval:s4
```

Metrics: `fixes_applied`, `forbidden_patterns`, `structural_contract` (target ≥95% composite).
