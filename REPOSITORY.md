# Git repository

Source, prompts, manifests, tests and captured evaluation evidence are committed and published with meaningful change history.

Published repository and configured origin: https://github.com/kevinkozakewich/Stage5.

The nine previously unpushed commits, through `cfd0247ee5a424bcb6c1cf3af8c256caf4f9018e`, are now published on `main`. GitHub's branch SHA was verified against the local SHA after pushing. The repository includes the source, evaluation evidence, and `level-5-certification-staging.zip`.

**Requested destination:** https://github.com/ImaginetKevinK/Stage5 — create/push as the `ImaginetKevinK` GitHub user (the `kevinkozakewich` CLI account cannot create repos under that login):

```powershell
gh auth login --hostname github.com --git-protocol https --web
gh auth switch
powershell -NoProfile -File scripts/publish-imaginet-stage5.ps1
```

The submission contains `Assignment/repository/git-log-export.txt` and a package manifest identifying the source commit and file hashes.

