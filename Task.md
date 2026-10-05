# Level 5 Certification — Task

**Task:** `2026-09-14 - Certifications / Level 5`
**Status:** Not fully verified — see `EXAMINER_CHECKLIST.md` (2026-10-05)
**Reference:** `What We Examine.txt`, `Instructions.txt` (Stage 5 certification framework)
**Prerequisite:** Level 4 complete (`Level 4/Assignment/`, 42/42 submission validator)

---

## What Does Stage 5 Look Like?

Stage 4 taught us the importance of linking Stage 3 prompts into a cohesive workflow, with guardrails between steps, proven punch-outs to humans, end-to-end success monitoring, and a per-step audit trail showing model, tokens, and cost. The critical question for Stage 4 was **"When you chain prompts together, how do you keep them from sliding into chaos?"**

In Stage 5, we now look to **delegate**. The critical question for Stage 5 is **"When you give an AI system the authority to coordinate other AI systems, how do you ensure it governs wisely instead of becoming a mega-agent that does everything itself?"**

Stage 5 is about building a **coordinator agent** — an LLM that holds only dispatch tools and reasons over the results of sub-agents it launches. The coordinator does not do the work itself. It does not read files, call HTTP endpoints, or run commands. It dispatches sub-agents to do those things, reads their results, reasons over them, and decides what to do next.

Runtime inference via agentic CLI shells (`claude`, `codex`, `devin`, etc.) is an **automatic FAIL**. CLI usage inside `evals/`, `tests/`, or `evaluations/` directories is evaluation, not runtime — that is exempt.

The instructions offer an Improving API key as an implementation option. They do not mandate a vendor or an API key; hosted subagents must still demonstrate the required scope, governance, guardrails, and audit evidence.

---

## The Coordinator

The coordinator is an LLM agent with **one tool per sub-agent**. Each tool is purpose-built (for example `launch_spec_parser`, `launch_adversarial_reviewer`, `launch_delivery_report_writer`) and each tool can target a **specific step** of a workflow, not just the whole workflow from the top.

The coordinator calls a sub-agent, reads the result, reasons, and calls the next one. If the adversarial reviewer raises a critical challenge, the coordinator re-invokes the producing workflow with the challenges as added context, targeting the specific artifact that was challenged. Then it re-reviews. **Governance is in the LLM's reasoning**, not in imperative if/while code alone.

The coordinator must be **dispatch-only**. If the coordinator holds a `read_file` tool, or an `http_get` tool, or a bash tool — that is the **mega-agent counterfeit**. A coordinator that can do real work is a single agent pretending to be a delegation system.

---

## Sub-Agents Scoped to One Workflow

Each sub-agent is limited to the specific tools, workflow skills, and steps needed for its single assigned workflow. No broader access. An adversarial reviewer is scoped by its review assignment; a reviewer covering several sub-agents is the required pattern, not a scoping violation. Scoping is judged against the submission's **declared tools**, not from what the workflow name suggests.

Each workflow keeps its **Stage 3 guarantees**: prompt, at least **3 named evaluation criteria**, and **measured results**. Evaluation artifacts must be present or clearly referenced. Measured results must be structured evidence — a committed `results.json`, a results table, or a CI run record — not a prose claim.

Agents that still need regular manual correction **disqualify** the workflow.

---

## Adversarial Review in Its Own Context

A dedicated adversarial agent reviews each sub-agent's output in its **own distinct context window**, separate from the agent whose work it is checking. The reviewer should have **read_file** access to verify the draft's claims against actual source files when substantiation matters.

Isolation is provable by construction (a fresh API call per review) or by manifest declaration (`isolated_context: true`). A reviewer that shares the producing agent's message history **fails** — it is a second opinion inside the same context, not adversarial review.

---

## Final Review Writer (Delivery Report)

The final review is a **distinct workflow** of its own. It receives all context from all agents as moderated by the coordinator — the original workflow output, the adversarial review verdict and challenges, and the coordinator's disposition — and synthesizes them into a polished report.

The tone is polite, encouraging but direct. The final review writer **does not add new findings** the examiner and adversarial reviewer did not raise. Its value is clarity, tone, and completeness of synthesis.

Report **headings are deterministic** — they come from the artifact findings, not from the LLM. A PASS artifact gets a PASS heading. A FAIL artifact gets a FAIL heading. The LLM writes the prose; the harness assembles the structure.

---

## Stage 4 Continuity

All Stage 4 guarantees must be maintained across every sub-workflow:

| Guarantee | Requirement |
|---|---|
| **Custom harness** | Fully custom harness — no CLI shells for runtime inference |
| **Punch-outs honored** | Coordinator may not auto-approve past a human checkpoint |
| **Substance elevation** | Toy or ≥2 peripheral workflows block final disposition until human Continue/Reject |
| **Per-step evals** | Every workflow keeps Stage 3 guarantees with structured measured results |
| **Audit trail** | Per-step model/token/cost data; **correlation ID** per examination; **persisted to disk** |

---

## Deterministic Guardrails Between Steps

Stage 5 carries forward Stage 4's deterministic guardrail discipline at the **delegation boundary**. When the coordinator dispatches a sub-agent, the harness enforces schema validation on the sub-agent's output **before** the coordinator ever sees it. If a sub-agent returns something that doesn't validate, the coordinator gets a **structured error** — never garbage — and can reason over the error to decide whether to retry or proceed.

The coordinator reasons; the harness enforces structure.

---

## Substance Assessment

For each workflow in your system, assess its relevance to an IT consultant's real work: **core** (work a paying client would buy), **peripheral** (useful but not billable on its own), or **toy** (hobby, game, or demo).

If any workflow is scored **toy**, or **two or more** are **peripheral**, the system elevates for human review. The human override is **append-only** — the system's report is retained verbatim; the decision is logged with the reviewer's identity.

---

## What We Examine

Your ZIP file is examined for the required Stage 5 artifacts. Each artifact is evaluated against specific criteria from the Stage 5 certification framework. **Artifacts are identified by their content, not their file names.**

| # | Theme | Criteria summary |
|---|---|---|
| 1 | **Dispatch-only coordinator** | No direct tool/file/workflow steps of its own; dispatch surface only; no mega-agent tools |
| 2 | **Sub-agents scoped to one workflow** | Per-workflow tool manifests; Stage 3 guarantees; no chronically manual workflows |
| 3 | **Adversarial review (isolated)** | Distinct context; adversarial lens; not shared producer history |
| 4 | **Version-controlled repository** | Coordinator, sub-agents, workflow definitions committed; meaningful history |
| 5 | **Stage 4 continuity** | Custom harness; punch-outs at coordinator boundary; audit with model/token/cost |
| 6 | **The counterfeit** | Coordinator with real-work tools = mega-agent fail |

---

## Optional: README

A README file may be included to guide the examiner through file structure, how to run the delegation system, and how to interpret the evidence artifacts.
