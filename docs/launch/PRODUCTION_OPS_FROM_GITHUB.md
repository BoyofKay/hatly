# Production operations from GitHub (no Mac needed)

`.github/workflows/production-ops.yml` runs the release runbook on the OVH server over SSH. It starts when a commit is pushed to the
`ops-request` branch, or from **Actions → Production ops → Run workflow**. Each run **waits for the owner's approval** (environment
`production`) and saves its full log to the `ops-log` branch.

| ACTION | What it does |
|---|---|
| `status` | current release, container health, migrations, disk. Changes nothing. |
| `deploy` | the pushed commit becomes the live release: bundle → upload → sha256 check → build → env-check → migration plan → backup + restore drill → migrate (only if pending) → switch → health. If the backend is not healthy, it switches back automatically. |
| `rollback` | ARG = an older release id still on the server. Switches the apps back; the database is not touched. |
| `reset-dry-run` / `reset-apply` | the test-data reset (`reset-test-orders-and-drivers.sql`) with ARG = cutoff, e.g. `2026-11-21 23:59:59+02`. Apply takes a backup first. |

## One-time setup (owner, about 10 minutes)

1. **Make a deploy key** (Git Bash on your laptop):
   ```bash
   ssh-keygen -t ed25519 -N "" -C hatly-github-deploy -f ~/.ssh/hatly_deploy
   ```
2. **Put the public half on the server.** Open `~/.ssh/hatly_deploy.pub` and add that one line to `/home/ubuntu/.ssh/authorized_keys`.
   Do this from any machine that can already reach the server (your brother's Mac), or from the OVH control panel's KVM console.
3. **Add the secrets** in GitHub: repo **Settings → Secrets and variables → Actions → New repository secret**.
   - `PROD_SSH_KEY`: the whole content of `~/.ssh/hatly_deploy` (the private file, without `.pub`).
   - `PROD_HOST`: `152.228.240.4`
   - `PROD_USER`: `ubuntu`
4. **Require your approval**: **Settings → Environments → New environment** named `production` → tick **Required reviewers** → add yourself.
5. **Delete the private key file from your laptop** once it is saved in GitHub (it is in GitHub now; GitHub never shows it again).

Never paste the private key into a chat.

## How Claude uses it
Claude pushes the commit to deploy to `ops-request` with `ops/REQUEST`. You get a GitHub notification and click **Approve**. Then Claude
reads `git fetch origin ops-log` and checks the live site.
