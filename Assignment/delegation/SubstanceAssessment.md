# Substance assessment — delegated trigger delivery system

Honest self-assessment for Stage 5 substance elevation (≥2 **peripheral** workflows triggers human Continue/Reject before final disposition).

| Workflow ID | Name | Substance | Rationale |
|---|---|---|---|
| W1 | Spec parse | **core** | Parses client migration briefs — billable delivery work |
| W2 | Trigger codegen | **core** | Produces deployable trigger SQL |
| W3 | Trigger review | **core** | Contract verification on production-bound artifacts |
| W4 | Remediate | **core** | Fixes review failures within delivery pipeline |
| W5 | Adversarial review | **peripheral** | Quality gate — not sold standalone |
| W6 | Delivery report | **peripheral** | Communication layer on top of delivery |
| C | Coordinator | **peripheral** | Governance — not a client deliverable |

**Elevation:** Two peripheral workflows (W5, W6) plus peripheral coordinator → harness blocks `SUCCESS` until a human records **Continue** or **Reject** in `delegation/substance-overrides.jsonl` (append-only). Golden runs also stop for a real recorded decision. The operator command `harness/record-substance-decision.js` appends reviewer identity, decision, correlation ID, report hash, and the verbatim report. Flags do not grant approval. The historical certification-harness example row is retained but cannot authorize a current examination.
