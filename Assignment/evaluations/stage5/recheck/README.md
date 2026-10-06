# Current policy recheck

These additional measurements test the literal requirement that material adversarial criticism reaches the targeted examiner and then receives independent re-review. They also test final FAIL synthesis without hiding open findings or granting deployment approval.

The initial five calls used the frozen prompt/source snapshot in `source_manifest`. They cover a targeted W3 examination with unchanged original challenge objects, independent W5 review of the examiner response, rejection of a terminal shortcut despite an exhausted repair budget, an allowed terminal FAIL after required reviews, and grounded W6 prose for that failed examination. Each response was captured once and remains unchanged.

An additional sixth call measures the later clarification that an UPHELD FAIL review can still contain material new findings. That case uses its own `source_manifest`, which is also the suite's `final_source_manifest`. The earlier cases and source manifest are preserved. `source_manifests` records both versions, and `current-source/` retains the final exact source bytes. The W6 prompt and dispatch schema did not change between these two snapshots. Each inference packet contains the actual prompt given to that model call.

Immediate SQL repair can be a lawful intermediate choice when budget remains; it does not replace required targeted examination and independent re-review. The old standalone `c1-adversarial-overturn` sample chose W4 but contained no later examination/re-review measurement. It is retained as prior-policy evidence rather than counted as proof of the complete current C1 obligation. The new source-bound cases and harness cycle regressions provide that proof.

Deterministic scoring checks the selected tool, immutable target, original challenge preservation, terminal prerequisites, evidence coverage and report structure. Disposition wording is assessed by a separate blind semantic judge, avoiding false failures from equivalent wording. In case 6 the optional `challenges` argument can be omitted because the harness supplies the canonical context; any supplied copy must be unchanged.

All inference is confined to this evaluation directory and uses a fresh signed-in native session per case. No model output is manually edited or retried. `raw/case-01/` through `raw/case-06/` preserve exact output, native events, response IDs, measured tokens and source hashes. Billed USD remains explicitly unavailable. `semantic-review/` preserves the fresh independent judge's exact six-pair review; the blind case IDs are mapped without changing its judgments.

Replay with `node evaluations/stage5/recheck/score.js`. The builders and inference runners are for a new unfrozen suite; they refuse to overwrite captured evidence. The main readiness checker independently verifies the raw bindings and versioned current-policy coverage.
