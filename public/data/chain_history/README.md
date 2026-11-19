# chain_history retention policy

This directory holds only the **last 7 daily snapshots** (`YYYY-MM-DD.json`).

- The site needs just a few days: the main page's 24h-change column walks back
  up to 3 days, and the subnet detail charts read whatever window is present.
- `update_site.sh` on the research server syncs the last 7 days nightly and
  deletes anything older from this checkout, so the repo does not regrow.
- Full history (since 2025-02-16) lives on the research server at
  `/root/tao-signal-pipeline/data/chain_history/`.

Trimmed 2026-11-19 to cut Vercel deploy weight (was 588 files / ~35MB).
