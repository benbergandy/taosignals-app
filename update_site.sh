#!/bin/bash
set -e
PIPELINE=/root/tao-signal-pipeline
SITE=/root/taosignals-app/public/data
TODAY=$(date -u +%Y-%m-%d)
echo "=== update_site.sh (Next.js) === ${TODAY}"

# Core data
cp ${PIPELINE}/data/chain_data.json ${SITE}/
cp ${PIPELINE}/data/combined_scores.json ${SITE}/
cp ${PIPELINE}/data/subnets.json ${SITE}/
cp ${PIPELINE}/data/risk_metrics.json ${SITE}/
cp ${PIPELINE}/data/regime_state.json ${SITE}/

# Paper trading - all profiles
cp ${PIPELINE}/data/paper_portfolio.json ${SITE}/
cp ${PIPELINE}/data/paper_daily_log.json ${SITE}/
cp ${PIPELINE}/data/paper_trades.json ${SITE}/
for suffix in conservative aggressive balanced_sharpe balanced_calmar balanced_alpha fulldeploy sortino_v21; do
  [ -f ${PIPELINE}/data/paper_portfolio_${suffix}.json ] && cp ${PIPELINE}/data/paper_portfolio_${suffix}.json ${SITE}/
  [ -f ${PIPELINE}/data/paper_daily_log_${suffix}.json ] && cp ${PIPELINE}/data/paper_daily_log_${suffix}.json ${SITE}/
  [ -f ${PIPELINE}/data/paper_trades_${suffix}.json ] && cp ${PIPELINE}/data/paper_trades_${suffix}.json ${SITE}/
done

# Wallet monitor
[ -f ${PIPELINE}/data/wallet_monitor.json ] && cp ${PIPELINE}/data/wallet_monitor.json ${SITE}/

# Bot mirror execution log (per-run snapshots of real wallet vs paper portfolio)
[ -f ${PIPELINE}/data/bot_mirror_log.json ] && cp ${PIPELINE}/data/bot_mirror_log.json ${SITE}/

# Sleeve outputs + per-profile sleeved portfolios (core/satellite/root architecture)
[ -f ${PIPELINE}/data/sleeve_outputs.json ] && cp ${PIPELINE}/data/sleeve_outputs.json ${SITE}/
for profile in conservative balanced aggressive buyhold core_only balanced_vsat; do
  [ -f ${PIPELINE}/data/paper_portfolio_${profile}_sleeved.json ] && \
    cp ${PIPELINE}/data/paper_portfolio_${profile}_sleeved.json ${SITE}/
done

# Chain history snapshots (last 30 days for subnet charts)
mkdir -p ${SITE}/chain_history
for i in $(seq 0 30); do
  DATE=$(date -u -d "${TODAY} - ${i} days" +%Y-%m-%d 2>/dev/null || date -u -v-${i}d +%Y-%m-%d)
  [ -f ${PIPELINE}/data/chain_history/${DATE}.json ] && cp ${PIPELINE}/data/chain_history/${DATE}.json ${SITE}/chain_history/
done

# Tail risk
[ -f ${PIPELINE}/data/tail_risk.json ] && cp ${PIPELINE}/data/tail_risk.json ${SITE}/

# Push to GitHub (triggers Vercel auto-deploy)
cd /root/taosignals-app
git add .
git commit -m "daily update ${TODAY}" --allow-empty
git push

echo "Site updated and deployed via Vercel"
