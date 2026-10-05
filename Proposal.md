# Level 5 Certification — Proposal

**Task:** `2026-09-14 - Certifications / Level 5`
**Status:** Complete — 2026-10-05
**Reference:** `Task.md`, `What We Examine.txt` (Stage 5 certification framework)
**Prerequisite:** Level 4 submission (`Level 4/Assignment/`) at **42/42** `validate:submission`; Level 3 S3 unchanged at ≥95%

---

## 1. Goal

Produce a submission ZIP that passes the **Stage 5 certification framework** — identified by **content**, not file names. The examiner looks for a **dispatch-only coordinator**, **sub-agents scoped to one workflow each**, **adversarial review in its own context**, **version-controlled source with meaningful history**, and **full Stage 4 continuity** inside a multi-workflow delegation system.

Success means an examiner can unzip the package, confirm the coordinator exposes **only** `launch_*` / dispatch tools (no mega-agent counterfeit), run an end-to-end **examination** (correlation ID) through the coordinator, see harness **schema validation** on every sub-agent return before the coordinator reads it, observe **isolated** adversarial review, verify **punch-out and substance gates** block auto-approval, read structured **measured results** for every Stage 3 workflow, and trace the full run in **persisted JSONL** with per-step model, tokens, and cost — including coordinator turns.

---

## 2. What the Examiner Looks For

| Theme | Format | Key bar |
|---|---|---|
| **Dispatch-only coordinator** | Prompt + tool schema + harness wiring | No direct file/HTTP/shell/workflow tools on coordinator; dispatch surface only |
| **Sub-agents scoped to one workflow** | Per-workflow manifests + prompts + evals | Tool manifests match declared access; Stage 3 bar (prompt, ≥3 criteria, measured results) per workflow |
| **Adversarial review (isolated)** | Sub-agent prompt + manifest (`isolated_context`) | Fresh context per review; challenge/catch/detect lens; not producer message history |
| **Version-controlled repository** | Git history in submission + optional log export | Coordinator, sub-agents, workflow definitions committed; meaningful commits |
| **Stage 4 continuity** | Harness + punch-out + metrics + audit | Custom harness (no CLI runtime inference); punch-outs at coordinator boundary; audit persisted to disk |
| **The counterfeit (avoid)** | — | Coordinator with real-work tools = automatic fail |
| **README** *(optional)* | Markdown | How to run coordinator path, golden path, manifests, audit correlation IDs |

Stage 4’s five artifact types (**workflow, guardrails, punch-out, E2E, audit**) **remain required in substance**; Stage 5 adds the **delegation layer** above them.

---

## 3. Recommended System Topic

Extend the completed Level 4 **Downstream Migration Trigger Delivery Pipeline** into a **delegated delivery system** — same business problem (brief → compliant `trigger.sql` → human deploy sign-off), but the **coordinator LLM** decides dispatch order and retries; the harness enforces structure, guardrails, and human gates.

### Why this topic

| Factor | Rationale |
|---|---|
| **Level 4 reuse** | S1–S4 prompts, golden evals, G1–G4 scripts, P1 punch-out, fixtures, and audit schema already exist |
| **Clear sub-workflows** | Spec parse, codegen, review, remediate, adversarial challenge, and delivery report map to separate manifests |
| **Real delegation story** | Adversarial overturn → coordinator re-dispatches review/remediate with challenge context is the Stage 5 governance pattern |
| **Core substance** | Paying-client database migration work — honest **core** rating; support workflows justified as gates, not toys |
| **Measurable coordinator** | Golden fixtures can assert dispatch sequences and final disposition without API key; live path uses Improving API key |

### Candidate systems (ranked)

| # | System | Workflows | Why it fits | Risk |
|---|---|---|---|---|
| **A** | **Delegated trigger delivery** — coordinator dispatches L4 agents + isolated adversarial + delivery report writer | 6 sub-workflows + coordinator | Direct fork of Level 4; richest guardrail/delegation boundary story | Refactor orchestrator without breaking 42/42 L4 evidence |
| **B** | **Certification package examiner** — coordinator dispatches examiner / adversarial / final writer on arbitrary ZIPs | 3 sub-workflows + coordinator | Matches framework doc naming literally | New domain; weak reuse of L4 investment |
| **C** | **WorkLog delegation** — coordinator dispatches intake / classify / synthesize / fact-check | 4+ workflows | Reusable narrative | Harder E2E determinism; less L4 reuse |

**Recommendation:** **Topic A** — same topic chain as Level 3 → Level 4; Stage 5 is an architectural upgrade, not a new product.

**Selected topic:** **A — Delegated Downstream Migration Trigger Delivery System**.

---

## 4. Delegation Architecture

### 4.1 Roles

| Role | What it is | What it must not do |
|---|---|---|
| **Coordinator (C)** | Mid-tier LLM with **one dispatch tool per sub-workflow** | Read files, run guardrails, call HTTP, shell, or embed S1–S4 prompts inline |
| **Harness (H)** | Node.js runtime: invoke coordinator, run sub-agents, validate outputs, apply G1–G4, enforce P1/S-substance gates, assemble report headings | Replace coordinator reasoning with a fixed step list (except safety caps) |
| **Sub-agent (W*)** | Single workflow: prompt + tool manifest + Stage 3 evals | Access tools outside manifest; share context with adversarial reviewer |

Level 4’s `harness/lib/router.js` becomes a **routing oracle and safety cap** (max remediate cycles, illegal transition detection) — **not** the primary control loop. Primary loop: **coordinator ↔ harness dispatch API**.

### 4.2 Coordinator dispatch tools (dispatch-only surface)

Each tool accepts a **target step** (or artifact focus) so the coordinator can re-invoke one step after adversarial challenge — not only “run whole pipeline from top.”

| Tool name | Sub-workflow | Typical dispatch |
|---|---|---|
| `launch_spec_parser` | W1 — Spec parse | Brief → `requirements.json` |
| `launch_trigger_codegen` | W2 — Trigger codegen | `requirements.json` → `trigger.sql` |
| `launch_trigger_review` | W3 — Trigger review | `trigger.sql` → `review.json` |
| `launch_remediator` | W4 — Remediate | `review.json` + `trigger.sql` → revised SQL |
| `launch_adversarial_reviewer` | W5 — Adversarial review | PASS `review.json` + `trigger.sql` → challenge JSON |
| `launch_delivery_report_writer` | W6 — Delivery report | Moderated bundle → markdown body (headings from harness) |

**Coordinator prompt:** `coordinator/prompt/Prompt.md` — RTCC; documents when to dispatch each tool, how to react to `VALIDATION_ERROR`, guardrail halt, adversarial `OVERTURNED`, and `PENDING_HUMAN` / substance elevation.

**Coordinator evals:** `coordinator/evals/` — criteria **C1–C4** (below); golden provider for offline submission gate; live eval optional under `support/live-evals/coordinator/`.

### 4.3 Sub-workflow roster (each = Stage 3 + manifest)

Reuse Level 4 agent folders where possible; **move** G3 LLM prompt into W5 as a first-class sub-agent.

| ID | Workflow | Folder | Tools (manifest) | Output | Stage 3 bar | L4 source |
|---|---|---|---|---|---|---|
| **W1** | Spec parse | `agents/spec-parser/` | *(none — text in/out via harness)* | `requirements.json` | ≥95% S1 evals | Unchanged |
| **W2** | Trigger codegen | `agents/trigger-codegen/` | *(none)* | `trigger.sql` | ≥95% S2 evals | Unchanged |
| **W3** | Trigger review | `agents/trigger-review/` | *(none)* | `review.json` | ≥95% E1–E3 | Level 3 copy — do not edit without L3 re-cert |
| **W4** | Remediate | `agents/remediator/` | *(none)* | `trigger.sql` | ≥95% S4 evals | Unchanged |
| **W5** | Adversarial review | `agents/adversarial-review/` | `read_file` (scoped to run artifact dir) | `adversarial.json` | ≥95% on challenge fixtures | Prompt from `guardrails/adversarial-review/Prompt.md`, elevated to isolated runner |
| **W6** | Delivery report | `agents/delivery-report/` | *(none)* | `report-body.md` | ≥95% synthesis fidelity (no new findings) | **New** |

**Manifest files:** `workflows/<id>/manifest.json` — fields: `workflow_id`, `allowed_tools`, `isolated_context` (true for W5 only), `substance` (`core` \| `peripheral` \| `toy`), `input_schema`, `output_schema` refs.

Measured results per workflow: `workflows/<id>/evals/results.json` (or CI artifact reference) — **committed**, not prose-only.

### 4.4 End-to-end flow (coordinator-governed)

```
[Brief + correlation_id]
    ↓
  C  reasons → launch_spec_parser
    ↓ H validates requirements.json (G1) → returns structured result or VALIDATION_ERROR to C
  C  → launch_trigger_codegen
    ↓ H validates trigger.sql (G2)
  C  → launch_trigger_review
    ↓ H validates review.json schema
  C  → launch_adversarial_reviewer   (W5: fresh API context)
    ↓ H validates adversarial.json
  ┌─┴─┐
  OVERTURNED / FAIL path          PASS upheld
  C re-dispatches W4/W3 as needed   C → launch_delivery_report_writer (after G4)
  (loop capped by H)                ↓ H assembles PASS/FAIL headings deterministically
  C may halt on guardrail fail      P1 human + S-substance gates before SUCCESS
```

Guardrails **G1–G4** stay **deterministic harness code** (`guardrails/`) — invoked **after** sub-agent return, **before** result is passed to coordinator (delegation-boundary validation).

### 4.5 Coordinator eval criteria

| ID | Criterion | Type |
|---|---|---|
| **C1** | Dispatches correct workflow after adversarial `OVERTURNED` (re-review or remediate, not skip to report) | Golden dispatch trace tests |
| **C2** | Does not complete disposition while P1 pending or substance elevation open | Injection tests |
| **C3** | Respects `VALIDATION_ERROR` — retries or aborts without inventing artifacts | Fixture transcripts |
| **C4** | Never receives non-dispatch tools in schema (static manifest check) | Validator + unit test |

Target: **≥95%** on C1–C4 (same bar as W1–W4 at Level 4).

### 4.6 What happens to Level 4 orchestrator artifacts

| L4 artifact | L5 disposition |
|---|---|
| `workflow/WorkflowDefinition.md` | Rewrite as **delegation map**: sub-workflows, coordinator tools, handoffs; retain pipeline diagram as “logical delivery graph” |
| `workflow/evals/routing.test.js` | Keep as **harness oracle** tests (illegal states); add `coordinator/evals/` for dispatch traces |
| `harness/run-workflow.js` | Split: **`run-delegation.js`** (coordinator loop + live/mock sub-runs) + **`run-workflow-golden.js`** (optional fast regression alias) |
| `harness/lib/router.js` | Safety caps + transition validation only; not primary scheduler |
| G3 inline mock step | Removed from linear loop; W5 sub-agent + isolation |

---

## 5. Guardrails at the Delegation Boundary

Stage 5 discipline: **coordinator reasons; harness enforces structure.**

| When | Validation | On failure |
|---|---|---|
| After W1 | G1 + JSON Schema | Structured `VALIDATION_ERROR` to coordinator |
| After W2 / W4 SQL | G2 sql-sentinel | Same |
| After W3 | `review.json` schema + G4 when proceeding to report | Same |
| After W5 | Adversarial challenge schema (`UPHELD` \| `OVERTURNED`, evidence fields) | Same |
| After W6 | Non-empty markdown body | Same |

Unit tests in `guardrails/tests/` remain **100%** on known bad handoffs. Adversarial **LLM** lives in W5; G3 prompt content moves to `agents/adversarial-review/prompt/Prompt.md`.

---

## 6. Adversarial Review (W5)

Requirements from Stage 5 framework:

- **Distinct context** — harness starts **new** provider session per `launch_adversarial_reviewer`; manifest `isolated_context: true`; no W3 message history passed.
- **Distinct lens** — prompt retains challenge/catch/detect language; output JSON only.
- **File access** — W5 manifest allows `read_file` limited to run artifact paths so reviewer can verify claims against `trigger.sql`.

Evals: migrate/extend G3 golden scenarios into `agents/adversarial-review/evals/` with measured `results.json`.

---

## 7. Delivery Report Writer (W6)

Maps to framework **final review writer** — renamed for Topic A.

- **Input (from harness, moderated by coordinator):** final `trigger.sql`, `review.json`, `adversarial.json`, coordinator disposition notes, artifact PASS/FAIL list.
- **Output:** markdown **body** only; **headings** (`## PASS — trigger.sql`, `## FAIL — …`) assembled deterministically by harness from artifact verdicts — headings never pass through the LLM.
- **Constraint:** no new findings beyond W3/W5; evals check for hallucinated violations.

---

## 8. Punch-Out and Substance Gates

### 8.1 P1 — DBA deployment approval (carry forward)

Same semantics as Level 4: after technical PASS + G3/G4 upheld, coordinator must not mark run **SUCCESS** until `.human-approved` exists. Bypass tests A/B/C remain in `punch-out/`; re-run under **coordinator** entrypoint.

### 8.2 S1 — Substance elevation (new)

Document in `delegation/SubstanceAssessment.md`:

| Workflow | Substance | Rationale |
|---|---|---|
| W1–W4 | **Core** | Billable migration delivery |
| W5 | **Peripheral** | Quality gate — not standalone client deliverable |
| W6 | **Peripheral** | Packaging / comms layer |
| Coordinator | **Peripheral** | Governance — not standalone deliverable |

With **two peripheral** workflows, harness **elevates** before final coordinator disposition until human records **Continue** or **Reject** in append-only `delegation/substance-overrides.jsonl` (system report retained verbatim).

### 8.3 Failure vs punch-out vs elevation

| Event | Type | Coordinator may auto-complete? |
|---|---|---|
| G1/G2/G4 fail | Automated fail | No |
| Retries exhausted | Automated fail | No |
| P1 missing | Punch-out | No |
| Substance elevation open | Human routing | No |
| `--force-complete` / premature sentinel | Bypass blocked | No |

---

## 9. Stage 4 Continuity (inside delegation)

| Guarantee | L5 implementation |
|---|---|
| Custom harness | Node `run-delegation.js`; no `claude`/`codex`/agentic CLI for **runtime** inference |
| E2E success rate | Re-run `harness/batch-run.js` (or delegation equivalent) — headline E2E under coordinator; update `metrics/E2EReport.md` |
| Audit trail | JSONL per run + **`correlation_id`** on every line (examination trace); coordinator steps logged with model/tokens/cost |
| Persisted audit | Write under `audit/` on disk — survives process exit |
| Per-workflow Stage 3 | Each W* keeps prompt + ≥3 criteria + committed measured results |

---

## 10. End-State Deliverable Layout

```
Level 5/
├── Proposal.md                       ← this file (not submitted)
├── Task.md                           ← framework requirements (not submitted)
├── README.md, SUBMIT.md, COMPLETION.md, EXAMINER_CHECKLIST.md
├── package.json, scripts/            ← dev tooling (not submitted)
├── level-5-certification.zip         ← zip Assignment/ only
└── Assignment/                       ← ALL mandatory delivery code
    ├── coordinator/
    │   ├── prompt/Prompt.md
    │   ├── tools/schema.json         ← dispatch-only tool defs
    │   └── evals/                    ← C1–C4 + results.json
    ├── workflows/
    │   ├── w1-spec-parse/manifest.json
    │   ├── … w6-delivery-report/
    ├── agents/                       ← W1–W6 prompts + evals (L4 folders + new)
    ├── guardrails/                   ← G1–G4 + delegation validators
    ├── delegation/
    │   ├── SubstanceAssessment.md
    │   └── substance-overrides.jsonl ← append-only (example row)
    ├── punch-out/                    ← P1 + bypass evidence
    ├── metrics/                      ← E2E under delegation
    ├── audit/                        ← JSONL samples + correlation trace doc
    ├── harness/
    │   ├── run-delegation.js         ← coordinator loop
    │   ├── lib/dispatchRunner.js     ← sub-agent isolation + validation
    │   └── lib/auditLogger.js        ← extended for C + correlation_id
    ├── fixtures/
    └── README.md
```

Runtime output (`artifacts/`, live audit runs) at repo root — not submitted.

---

## 11. Work Plan

### Phase 0 — Prerequisite gate

1. Confirm Level 4 `npm run validate:submission` → **42/42 PASS**.
2. Copy `Level 4/Assignment/` → `Level 5/Assignment/` (clean copy; L4 tree unchanged).
3. Scaffold `coordinator/`, `workflows/*/manifest.json`, `delegation/`, `agents/delivery-report/`, `agents/adversarial-review/`.
4. Add root `Level 5/package.json` mirroring L4 scripts + `validate:submission`.

### Phase 1 — Manifests and substance

1. Write `delegation/SubstanceAssessment.md`.
2. Define output schemas for each W* (reuse existing JSON shapes).
3. Static check: coordinator tool schema lists **only** `launch_*` tools.

### Phase 2 — Sub-agent runners (harness)

1. Implement `dispatchRunner.js` — one function per workflow; W5 isolated session + scoped `read_file`.
2. Wire post-dispatch G1–G4 validation; return `VALIDATION_ERROR` shape to coordinator.
3. Keep all L4 agent golden evals passing (`npm run eval:s1` … `eval:s4`).

### Phase 3 — W5 adversarial + W6 delivery report

1. Move G3 prompt → `agents/adversarial-review/`; add evals + `results.json`.
2. Author W6 prompt + evals (no new findings; tone/clarity criteria).
3. Implement deterministic heading assembly in harness.

### Phase 4 — Coordinator

1. Draft `coordinator/prompt/Prompt.md` (RTCC, load-bearing ≥90%).
2. Implement live coordinator loop in `run-delegation.js` (OpenAI-compatible API — Improving key).
3. Implement golden/mock coordinator path for offline validator.
4. Add C1–C4 evals; target ≥95%.

### Phase 5 — Punch-out, substance, bypass

1. Port P1 gate to block coordinator SUCCESS.
2. Implement substance elevation gate + example override row.
3. Re-run bypass tests A/B/C via delegation entrypoint; update transcripts.

### Phase 6 — Audit + correlation

1. Add `correlation_id` to audit schema; log every coordinator turn.
2. Write `audit/ExampleDelegationTrace.md` (one full examination).
3. Confirm disk persistence across coordinator session.

### Phase 7 — E2E under delegation

1. Run batch fixtures through `run-delegation.js` (golden + spot live).
2. Update `metrics/E2EReport.md` with delegation headline number and ≥3 trend batches.

### Phase 8 — Self-certification checklist

- [ ] Coordinator manifest: dispatch-only tools; mega-agent static check passes
- [ ] Each W*: manifest, prompt, ≥3 eval criteria, committed measured results
- [ ] W5: isolated context provable (fresh session + manifest flag)
- [ ] W6: headings deterministic; body evals ≥95%
- [ ] G1–G4 at delegation boundary; unit tests 100%
- [ ] P1 + substance gates block coordinator auto-complete
- [ ] Stage 4 E2E + audit + punch-out evidence updated for L5 paths
- [ ] Git history meaningful; optional `git-log-export.txt`
- [ ] `README.md` reproduces golden path without API key
- [ ] `npm run validate:submission` → PASS (target checklist TBD in script)

### Phase 9 — Package & submit

```powershell
cd "C:\Projects\Improving\Memory\Tasks\In Progress\2026-09-14 - Certifications\Level 5"
Compress-Archive -Path Assignment -DestinationPath level-5-certification.zip -Force
```

Exclude `node_modules/`, API keys, `.env`.

---

## 12. Resolved Decisions

1. **System topic** — **A (Delegated trigger delivery)** — architectural upgrade of Level 4 Topic A, not a new domain.
2. **Coordinator tools** — **`launch_*` only** — six dispatch tools mapping to W1–W6; no harness/guardrail tools on coordinator.
3. **Orchestrator** — **LLM coordinator + Node harness** — `router.js` demoted to safety/oracle; not the primary scheduler.
4. **Adversarial** — **W5 sub-agent** with `isolated_context: true` and scoped `read_file`; G3 removed from linear mock loop.
5. **Final synthesis** — **W6 delivery report writer** with harness-built headings; framework “final review writer” pattern.
6. **Substance** — W1–W4 **core**; W5, W6, coordinator **peripheral** → substance elevation gate active; human append-only override.
7. **Primary model** — **GPT-4o** (`openai:gpt-4o`) for coordinator and sub-agents; consistent with L3/L4.
8. **Offline submission** — Golden/mock paths for validator and examiner quick start; live coordinator documented under `support/live-evals/`.
9. **Level 4 preservation** — Level 4 folder stays certified; Level 5 is a **copy-forward** under `Level 5/Assignment/`.

---

## 13. Immediate Next Steps

1. **Copy** `Level 4/Assignment/` → `Level 5/Assignment/`.
2. **Create** `workflows/w5-adversarial-review/manifest.json` with `isolated_context: true` and tool list.
3. **Scaffold** `coordinator/tools/schema.json` with six `launch_*` definitions only.
4. **Draft** `coordinator/prompt/Prompt.md` v0.1 — dispatch table only, no embedded SQL rules (those stay in W*).
5. **Implement** `harness/lib/dispatchRunner.js` stub that runs W1 with G1 validation and returns structured result to a mock coordinator.

Once dispatch stub + G1 boundary works, parallelize W5 prompt move and C1 golden tests.
