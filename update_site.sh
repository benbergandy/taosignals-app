#!/bin/bash
set -e
PIPELINE=/root/tao-signal-pipeline
SITE=/root/taosignals-app/public/data
TODAY=$(date -u +%Y-%m-%d)
echo "=== update_site.sh (Next.js) === ${TODAY}"

# 2026-05-03 cleanup: removed sync of legacy v2.1 paper portfolios + their
# daily logs and trade files (8 profiles total). All replaced by the V3+VSAT
# sleeved portfolios below. Also stopped syncing tail_risk.json (Bayesian
# AUC=0.589, never wired) and the obsolete .broken.bak.* audit-trail files.

# Core data
cp ${PIPELINE}/data/chain_data.json    ${SITE}/
cp ${PIPELINE}/data/combined_scores.json ${SITE}/
cp ${PIPELINE}/data/subnets.json       ${SITE}/
cp ${PIPELINE}/data/risk_metrics.json  ${SITE}/
cp ${PIPELINE}/data/regime_state.json  ${SITE}/

# Wallet monitor (real-money wallet snapshot)
[ -f ${PIPELINE}/data/wallet_monitor.json ] && cp ${PIPELINE}/data/wallet_monitor.json ${SITE}/

# Bot mirror execution log (per-run snapshots of real wallet vs paper portfolio)
[ -f ${PIPELINE}/data/bot_mirror_log.json ] && cp ${PIPELINE}/data/bot_mirror_log.json ${SITE}/

# Sleeve outputs + V3+VSAT per-profile sleeved portfolios + daily logs
[ -f ${PIPELINE}/data/sleeve_outputs.json ] && cp ${PIPELINE}/data/sleeve_outputs.json ${SITE}/
for profile in conservative balanced aggressive buyhold core_only balanced_vsat; do
  [ -f ${PIPELINE}/data/paper_portfolio_${profile}_sleeved.json ] && \
    cp ${PIPELINE}/data/paper_portfolio_${profile}_sleeved.json ${SITE}/
  [ -f ${PIPELINE}/data/paper_daily_log_${profile}_sleeved.json ] && \
    cp ${PIPELINE}/data/paper_daily_log_${profile}_sleeved.json ${SITE}/
  [ -f ${PIPELINE}/data/paper_trades_${profile}_sleeved.json ] && \
    cp ${PIPELINE}/data/paper_trades_${profile}_sleeved.json ${SITE}/
done

# Chain history snapshots (last 30 days for subnet detail charts)
mkdir -p ${SITE}/chain_history
for i in $(seq 0 30); do
  DATE=$(date -u -d "${TODAY} - ${i} days" +%Y-%m-%d 2>/dev/null || date -u -v-${i}d +%Y-%m-%d)
  [ -f ${PIPELINE}/data/chain_history/${DATE}.json ] && cp ${PIPELINE}/data/chain_history/${DATE}.json ${SITE}/chain_history/
done

# Purge already-deployed obsolete files. Listed explicitly so this remains
# auditable. After a single cron run these all disappear from the Vercel deploy.
rm -f ${SITE}/paper_portfolio.json
rm -f ${SITE}/paper_daily_log.json
rm -f ${SITE}/paper_trades.json
for suffix in conservative aggressive balanced_sharpe balanced_calmar balanced_alpha fulldeploy sortino_v21; do
  rm -f ${SITE}/paper_portfolio_${suffix}.json
  rm -f ${SITE}/paper_daily_log_${suffix}.json
  rm -f ${SITE}/paper_trades_${suffix}.json
done
rm -f ${SITE}/tail_risk.json
rm -f ${SITE}/composite_scores.json ${SITE}/momentum_scores.json
rm -f ${SITE}/opportunity_scores.json ${SITE}/quality_scores.json
rm -f ${SITE}/performance_log.json ${SITE}/backtest_results.json
rm -f ${SITE}/chain_history_failed.txt

# Push to GitHub (triggers Vercel auto-deploy)
cd /root/taosignals-app
git add .
git commit -m "daily update ${TODAY}" --allow-empty
git push

echo "Site updated and deployed via Vercel"
