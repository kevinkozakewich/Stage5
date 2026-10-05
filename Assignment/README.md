# Level 5 submission

Delegated downstream migration trigger delivery system.

**Coordinator governance:** The coordinator **LLM** is defined in `coordinator/prompt/Prompt.md` and may only call `launch_*` tools (`coordinator/tools/schema.json`). Live/subagent runs reason over sub-agent results (see repo `support/subagent-evals/outputs/coordinator-c1-overturn.txt`). **`run-delegation.js` uses a golden dispatch planner** for reproducible E2E and CI — same routing semantics, not a mega-agent with file/HTTP tools.

**Inference:** Subagent evals for S1–S4 (34/34) and Stage 5 samples; golden mocks inside delegation E2E. No API key required.

## Quick start

```bash
npm install
npm run validate
npm run delegation:golden
```

## Other commands

| Command | What it does |
|---|---|
| `npm test` | Guardrails, W1–W4 routing oracle, coordinator C1–C4 |
| `npm run delegation:batch` | E2E metrics via `run-delegation.js` (eight fixtures × trend batches) |
| `npm run delegation:golden` | Single examination with human + substance gates satisfied |
| `npm run workflow:golden` | Level 4 deterministic pipeline regression |
| `npm run eval:all` | Golden Promptfoo eval for S1–S4 |

## Stage 5 layout

| Area | Path |
|---|---|
| Coordinator (dispatch-only) | `coordinator/` |
| Sub-workflow manifests | `workflows/w1-spec-parse/` … `w6-delivery-report/` |
| Substance + overrides | `delegation/` |
| Delegation runtime | `harness/run-delegation.js` |
| Stage 4 continuity | `guardrails/`, `punch-out/`, `metrics/`, `audit/` |

## Pass bar

- `npm run validate` exits 0
- `npm test` all green
- E2E rate ≥90% in `metrics/e2e-report.md` (delegation batch)
- Coordinator tools: `launch_*` only (`coordinator/tools/schema.json`)
