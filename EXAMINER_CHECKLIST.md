# Level 5 examiner cross-check

Checked against the supplied `Instructions.txt` and `What We Examine.txt`, 2026-10-05.

**Full readiness is not yet established.** Previous blanket COMPLETE/PASS statements have been withdrawn. The repairs below address demonstrated gaps without changing the inference provider or introducing an API redesign.

## 1. Dispatch-only coordinator / counterfeit

The declared surface in `Assignment/coordinator/tools/schema.json` has six launch tools and no real-work tool. Tests reject unknown tools. The prompt describes LLM governance and targeted remediation.

Still unverified: the actual hosted coordinator's exposed tool surface and a complete LLM-governed run. `goldenCoordinator.js` is explicitly a deterministic evaluation oracle; the single saved coordinator response demonstrates only one dispatch choice. A manifest is not evidence that the host actually restricted tool access.

## 2. Scoped subagents and Stage 3 guarantees

W1-W6 manifests declare workflow-specific tools. All agent prompts have named evaluation criteria. The 34 historical S1-S4 outputs and their assertions are included in `Assignment/evaluations/` and can be replayed independently.

Still unverified: host enforcement of declared tools, sufficient measured coverage of all W5/W6/coordinator semantic criteria, and run provenance demonstrating that workflows do not need regular manual correction. Normal prompt tuning alone is not evidence of disqualification. Historical claimed percentages are not treated as new inference measurements.

## 3. Adversarial review in its own context

W5 declares `isolated_context: true`, a distinct adversarial lens, and read_file scoped to run artifacts. UPHELD and OVERTURNED examples exist. Current validators check findings members and consistent verdicts.

Still unverified: adversarial review of every worker output in the actual hosted orchestration. The golden replay checks W3's passing review and SQL; it does not prove broader W1/W2/W4/W6 review coverage. A mock session UUID is labelled simulated.

## 4. Version-controlled repository

Source, prompts, workflow manifests, tests, and historical evidence are kept in Git. Packaging includes a real history export. New commits document concrete fixes; no historical development sequence is fabricated.

## 5. Stage 4 continuity and boundaries

Verified by regression tests:

- Actual G1/G2/W3/W5/W6 output checks run before results enter coordinator context.
- G4 cannot trust a false-clean claim over the SQL validator.
- Revisions invalidate dependent reviews and preserve previous artifact versions.
- Failed agent outputs remain in the persisted correlation-linked audit.
- Substance elevation is derived from manifests; flags do not approve it.
- Human records identify the reviewer, retain the report verbatim, and honor later rejection.
- Finalization checks report/artifact hashes and approval timing without re-running or rewriting the report.
- The harness assembles deterministic headings; model-authored headings are rejected.

Still unverified: actual model/token/cost telemetry across a complete hosted execution. The existing runtime path is a fixture replay, and its usage is labelled simulated. There is no runtime agentic CLI call in the included delegation runner.

## 6. Final review synthesis

W6 prompt and historical output are present; nonempty prose and heading constraints are tested. The golden report is a fixture. The saved prose scorer does not prove complete synthesis or absence of unsupported findings. Sufficient measured evidence for those criteria remains necessary.

## Submission checks

`npm run validate:submission` checks structure, tests, archived assertions, and ZIP integrity. `npm run validate:readiness` additionally fails when mandatory evidence is not established. The generated ZIP is a review package, not an assertion that an examiner will award PASS.

Neither an OpenAI API key nor a particular endpoint is a certification requirement. Native hosted subagents remain an acceptable implementation route if the required behavior and evidence can be demonstrated.
