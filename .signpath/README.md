# SignPath setup

What the [Release workflow](../.github/workflows/release.yml) expects on SignPath, so Windows
releases come out signed. The policy users read is [CODE_SIGNING_POLICY.md](../CODE_SIGNING_POLICY.md).

## On SignPath

1. Turn on multi-factor authentication for your SignPath user (and keep it on for GitHub).
2. Install the SignPath GitHub App for `tahap0l/nobetci` and add **GitHub.com** as a trusted build
   system for the organization.
3. Create a project with the slug `nobetci` and link the repository `https://github.com/tahap0l/nobetci`.
4. Add two artifact configurations, pasting the files from
   [`artifact-configurations/`](artifact-configurations/):
   - slug `app` ← `app.xml` (the app and the relay)
   - slug `installer` ← `installer.xml` (the NSIS installer)
5. Add a signing policy with the slug `release-signing` that uses the SignPath Foundation
   certificate, requires **manual approval** (approver: `tahap0l`), uses the GitHub trusted build
   system, and allows only the `main` branch.
6. Create a CI user (submitter on that policy) and copy its API token.

## On GitHub (repository → Settings → Secrets and variables → Actions)

| Kind | Name | Value |
|---|---|---|
| Variable | `SIGNPATH_ORGANIZATION_ID` | the SignPath organization ID |
| Secret | `SIGNPATH_API_TOKEN` | the CI user's API token |
| Variable (optional) | `SIGNPATH_PROJECT_SLUG` | only if not `nobetci` |
| Variable (optional) | `SIGNPATH_POLICY_SLUG` | only if not `release-signing` |

Without `SIGNPATH_ORGANIZATION_ID` the workflow builds unsigned, exactly as before.

## Each release

Start the Release workflow as usual. It stops twice and waits (up to an hour each) for you to approve
on SignPath: first the programs, then the installer. Before approving, check that the request shows
the Release workflow, branch `main` and the commit you are releasing. After the first signed release,
update the status note in `CODE_SIGNING_POLICY.md` and on `website/code-signing.html`.
