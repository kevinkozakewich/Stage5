# Level 5 submission handoff

Use `level-5-certification.zip`. The staging and v2 ZIP aliases contain the same verified submission.

From the Level 5 directory:

```powershell
npm test
npm run eval:stage5
npm run delegation:batch
npm run package:zip
npm run validate:submission
npm run validate:readiness
```

Packaging includes the Assignment source, prompts, manifests, tests, historical and fresh evaluation packets/responses, semantic judgments, governed execution audit, measured usage, replay scorers, lockfile and real Git history. Environment files, dependencies and ordinary generated runtime directories are excluded. The evaluation evidence is self-contained.

After extracting, run from `Assignment/`:

```powershell
npm test
npm run validate
npm run eval:historical
npm run eval:stage5
npm run delegation:batch
```

No dependency install, API key or live inference is required for these checks. See `README.md` inside Assignment for application inference integration and separate human decision commands. The evaluated delivery waits at its required human checkpoint; no certification, substance or deployment approval has been entered on the user's behalf.

