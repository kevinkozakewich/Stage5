# Migration Brief — Incomplete Schema (G1 Halt)

**Fixture ID:** `fixture-06-g1-schema-fail`  
**Purpose:** Brief missing required fields; G1 schema validator halts before S2

---

## Target Table

| Field | Value |
|---|---|
| Schema | `PurinaNA` |
| Table | `BatchCampaign` |

## Trigger Specification

- **Type:** _(not specified — intentional omission)_
- **Primary key:** _(not specified)_

## Constraints

Brief is intentionally incomplete to test G1 requirements schema validation.

## Expected Delivery

Workflow **fails at G1** with origin step S1. No S2 invocation.
