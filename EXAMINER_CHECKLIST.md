# Level 5 examiner cross-check

Checked against the supplied `Instructions.txt` and `What We Examine.txt`. Readiness is computed by `npm run validate:readiness`; this document maps requirements to reviewable evidence.

## Dispatch-only coordinator and counterfeit

`Assignment/coordinator/tools/schema.json` exposes six purpose-built launch tools. The custom governed harness accepts only that surface and exact declared arguments. The coordinator receives validated outputs and decides the next dispatch. It has no file, HTTP, SQL, shell, human-approval, or artifact-writing capability.

Fresh coordinator evaluations include targeted repair, changed-artifact review, validation retry, human checkpoint restraint, direct-tool injection and prerequisite review. The governed native evaluation archives each actual coordinator decision and boundary result. The broader native CLI is used only as an evaluation transport; its raw event records are checked for host tool use.

## Scoped subagents and Stage 3 guarantees

W1–W6 manifests declare enforced workflow tools. W1–W4 and W6 have no application tools; W5 has only assignment-scoped `read_file`. Each workflow retains its prompt and at least three named criteria with structured results under its `evals/` directory.

The 34 historical S1–S4 outputs and assertions remain packaged with their original provenance limitations. Fresh W5 cases cover clean and defective outputs from every producing workflow, including partial remediation, preserved FAIL, invented findings and premature approval. Fresh W6 cases cover pending approval, partial repair, substance rejection and an approved handoff without deployment. A separate blind semantic review checks source grounding, completeness and tone.

Exact first-attempt outputs, response IDs, prompts, hashes and scoring results are retained. Model outputs are not manually repaired. Scorer adjustments and integration failures remain documented separately from model quality measurements.

## Independent adversarial review

The harness creates a distinct review context for each immutable W1/W2/W3/W4/W6 artifact. The W5 manifest requires `isolated_context: true`. Native evaluation requests use fresh thread IDs, with producer and reviewer identities retained. W5 can read assigned source files only after real-path and hash checks.

Every accepted producing output must have independent review before completion; current dependencies require an upheld review before use. Changed SQL invalidates the earlier examiner result and report. W5 does not recursively review itself.

## Version-controlled repository

Coordinator, subagents, manifests, custom harness, regressions and measured evidence are committed. `Assignment/repository/git-log-export.txt` records actual history. Packaging writes a SHA-256 manifest and verifies ZIP bytes against source. Historical development and measurement dates are not fabricated.

## Stage 4 continuity and deterministic boundaries

The runtime harness uses callbacks or JSON lines and invokes no agentic CLI. Real requirements, SQL, examiner, adversarial and report-body checks run before exposing outputs to the coordinator. Failed calls and structured errors are persisted. Regression coverage includes unknown tools, malformed output, stale responses, source tampering, prerequisite bypass, false-clean reviews and report-heading injection.

The full governed trace includes actual model identity, response-level tokens, correlation IDs, input/output hashes and persisted audit links. Native billed USD is unavailable and remains null. Each step retains a labelled Standard credit-equivalent estimate based on measured tokens and documented model rates; it is not represented as actual subscription consumption or dollar billing.

Human checkpoints remain outside coordinator tools. The two peripheral workflows trigger substance elevation. Append-only decisions retain the report verbatim and reviewer identity; later rejection, changed artifacts, stale decisions and failed examinations cannot become approved delivery. The recorded native run ends at `pending_human`, the required gate behavior.

## Final synthesis and deterministic headings

W6 receives current artifacts, prior findings, independent reviews and coordinator dispositions. It writes concise body prose without introducing findings. Its output is independently reviewed before the harness assembles the final report.

PASS/FAIL headings derive from validated artifact findings, never from model-authored headings. The runtime and regression cases cover terminal failure as well as a clean delivery. Human approval cannot promote a failed examination to success.

## Reproduce

`npm test` checks the current implementation. `npm run eval:stage5` and `npm run eval:historical --prefix Assignment` replay archived measurements without credentials. `npm run validate:readiness` rejects missing or altered mandatory evidence. Fresh native inference is optional and requires the already signed-in native CLI; it is not required to inspect the ZIP.

