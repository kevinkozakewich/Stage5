# Sub-agent inference evals (no API key)

Level 3–5 **live** validation does **not** call `OPENAI_API_KEY`. A **Cursor subagent** is the inference provider (same idea as sending prompts to any external host). The main agent sends a packet; the subagent may call further subagents; raw output is saved and scored with deterministic assertions.

See `INFERENCE.md`. Level 5 covers S1–S4 (all YAML tests), plus W5/W6/coordinator samples.

## Steps

1. **Packet** — Agent `prompt/Prompt.md` + one row from `evals/tests/*.yaml` (vars).
2. **Subagent** — Task prompt: *“Follow this system prompt exactly. Given the input below, produce ONLY the agent output (JSON or SQL as specified). No commentary.”*
3. **Save** — Write subagent reply to `support/subagent-evals/outputs/<agent>-<test>.txt`.
4. **Assert** — From Level 5 root:

```powershell
node scripts/assert-subagent-output.js s1 support/subagent-evals/outputs/s1-01.txt --test 01-batchcampaign-iud.yaml
```

Agents: `s1` | `s2` | `s3` | `s4`.

## Full bar

Repeat for every file in each agent’s `evals/tests/` (same count as golden Promptfoo). Composite ≥95% per agent matches Stage 3 certification.

## Stage 5 packets

```powershell
npm run packets:build
npm run eval:subagent:all
```

Packets: `packets/w5/`, `packets/w6/`, `packets/coordinator/`. Outputs: `outputs/w5-*`, `w6-*`, `coordinator-*`.
