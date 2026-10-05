# Inference model (Level 3 / 4 / 5)

**No `OPENAI_API_KEY` is required for certification.**

When we “run a prompt live,” we use **Cursor subagents** as the inference provider—the same way prompts would run on any external host. The main agent (or harness operator) sends a packet; a subagent executes the agent `Prompt.md` and returns raw output. Subagents may spawn their own subagents; that is normal delegation, not a separate harness mode.

| Layer | What runs | API key |
|-------|-----------|---------|
| Golden / CI | Fixture providers, `run-delegation.js` mocks | No |
| **Measured agent evals** | Subagent + `support/subagent-evals/outputs/` | **No** |
| Optional dev calibration | `support/live-evals/` Promptfoo + OpenAI | Optional |

Evidence: `results.json` (S1–S4, 34/34 @ 100%), Stage 5 samples under `outputs/w5-*`, `w6-*`, `coordinator-*`.
