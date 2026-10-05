# Level 5 submission handoff

**Status: review package; full certification readiness not yet established.** See `EXAMINER_CHECKLIST.md`.

Generate and verify from the Level 5 directory:

```powershell
npm test
npm run delegation:batch
npm run package:zip
npm run validate:submission
npm run validate:readiness
```

Use `level-5-certification-staging.zip`, regenerated after the current changes. Packaging includes Assignment source, prompts, manifests, tests, historical evaluation packets and raw outputs, replay assertions, lockfile, and an exported Git history. It excludes node_modules, environment files, and generated runtime directories. ZIP contents are compared with current source hashes.

After extracting, run from `Assignment/`:

```powershell
npm test
npm run validate
npm run eval:historical
npm run delegation:batch
```

These verify structural and regression behavior. Hosted subagent runtime scope, full review coverage, actual inference audit telemetry, and the unmeasured semantic criteria remain unverified. No API vendor is mandatory, and the existing historical hosted subagent evaluations remain valid evidence within their documented limits.

`npm run delegation:golden` intentionally stops at the human checkpoint (exit 2). Explicit human decision and finalization commands are documented in `Assignment/README.md`. No certification or deployment approval has been entered on the user's behalf.
