# Stage 5 — Delegated Trigger Delivery Certification

**Repository:** https://github.com/ImaginetKevinK/Stage5 (see `REPOSITORY.md` if transfer from `kevinkozakewich/Stage5` is pending)  
**Submission package:** `Assignment/` (zip via `npm run package:zip` → `level-5-certification-staging.zip`)

## Verify

```powershell
cd Assignment
npm install
npm run validate
npm run delegation:golden
cd ..
npm run eval:subagent:all
npm run validate:submission
```

**Live inference:** Cursor subagent (no API key) — `support/subagent-evals/INFERENCE.md`

Examiner map: `EXAMINER_CHECKLIST.md` · Handoff: `SUBMIT.md`
