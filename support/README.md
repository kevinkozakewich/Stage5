# Support files (not submitted)

Developer-only assets moved out of `Assignment/` so the submission zip contains only what an AI evaluator needs to run checks repeatedly.

| Path | Contents |
|---|---|
| `log/BuildLog.md` | Human build narrative |
| `agent-readmes/` | Per-agent docs removed from submission |
| `live-evals/` | Live Promptfoo configs (require `OPENAI_API_KEY`) |
| `guardrails/sql-sentinel.ps1` | PowerShell alternate for G2 |

Live evals run from repo root: `npm run eval:s1:live` … `eval:s4:live`, `npm run eval:live-streak`.
