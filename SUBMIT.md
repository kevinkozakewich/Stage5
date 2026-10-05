# Level 5 Certification — Submission Handoff

**Topic:** A — Delegated Downstream Migration Trigger Delivery System  
**Status:** Ready — 2026-10-05  
**Live inference:** Cursor subagent packets (no API key) — `support/subagent-evals/INFERENCE.md`

---

## What to Submit

Zip **`Assignment/` only** — self-contained; examiner replay uses golden path (no API key).

| Include (under `Assignment/`) | Exclude |
|---|---|
| `README.md` — examiner quick start | Root dev docs: `Proposal.md`, `SUBMIT.md`, `COMPLETION.md`, etc. |
| `coordinator/`, `workflows/`, `agents/`, `guardrails/`, `delegation/` | `support/` (keep locally for subagent evidence) |
| `harness/`, `fixtures/`, `punch-out/`, `metrics/`, `audit/` | Runtime `artifacts/`, live audit runs |
| `package.json`, submission scripts | `node_modules/`, API keys, `.env` |

**Ready-made zip:** `level-5-certification-staging.zip` (Assignment/ without node_modules).

Regenerate:

```powershell
cd "C:\Projects\Improving\Memory\Tasks\In Progress\2026-09-14 - Certifications\Level 5"
npm run package:zip
```

Do **not** `Compress-Archive -Path Assignment` directly — that bundles `node_modules`.

---

## Examiner Quick Start

Unzip and run from inside `Assignment/`:

```powershell
cd Assignment
npm install
npm run validate
npm run delegation:golden
```

Author evidence (optional, outside zip): from Level 5 root, `npm run eval:subagent:all` replays deterministic checks on saved subagent outputs.

---

## Optional dev calibration

`npm run eval:live:all` uses OpenAI via Promptfoo under `support/live-evals/` — **not** required for certification.
