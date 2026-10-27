#!/usr/bin/env bash
# 운영 알림을 적용한다. 로그 기반 지표(metrics/)와 알림 정책(policies/)은 정의대로 만들거나 고치고,
# 도메인 가동 확인과 월 예산은 없을 때만 만든다. 여러 번 실행해도 같은 결과다.
# 설명은 docs/deploy-gcp.md 11절.
#
#   PROJECT_ID=<프로젝트 id> ALERT_EMAIL=<알림 받을 메일> infra/monitoring/apply.sh
#
# 선택: SERVICE(bangsongteam), DOMAIN(bangsongteam.siku-labs.com), BILLING_ACCOUNT(프로젝트에 연결된
#       결제 계정), BUDGET_NAME(bangsongteam 월 예산), BUDGET_AMOUNT(10000KRW)
# 필요: gcloud(로그인), curl, jq. 예산은 결제 계정의 예산 관리 권한이 있어야 만들 수 있다.

set -euo pipefail

: "${PROJECT_ID:?PROJECT_ID가 필요합니다}"
: "${ALERT_EMAIL:?ALERT_EMAIL이 필요합니다}"
SERVICE=${SERVICE:-bangsongteam}
DOMAIN=${DOMAIN:-bangsongteam.siku-labs.com}
BUDGET_NAME=${BUDGET_NAME:-bangsongteam 월 예산}
BUDGET_AMOUNT=${BUDGET_AMOUNT:-10000KRW}
UPTIME_NAME="${SERVICE} 도메인 /api/health"

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
export CLOUDSDK_CORE_PROJECT=$PROJECT_ID

log() {
  echo "$@" >&2
}

retry() {
  local attempt
  for attempt in 1 2 3 4 5 6; do
    "$@" && return
    log "다시 시도합니다 (${attempt}/6)"
    sleep "${RETRY_DELAY:-10}"
  done
  "$@"
}

monitoring_api() {
  curl -fsS -H "Authorization: Bearer ${TOKEN}" -H "x-goog-user-project: ${PROJECT_ID}" \
    -H "Content-Type: application/json" "$@"
}

# bash는 $(…) 안에서 set -e를 끈다(bash 매뉴얼 'Command Execution Environment', inherit_errexit).
# 그래서 $(…)로 부르는 함수는 실패를 || return 1로 직접 돌려준다. 실패한 조회를 '없음'으로 읽으면
# 알림 채널 없는 정책을 만들거나 기존 정책의 채널을 비우고, 가동 확인을 또 만든다.
notification_channel() {
  local api="https://monitoring.googleapis.com/v3/projects/${PROJECT_ID}/notificationChannels"
  local name
  name=$(monitoring_api "$api" | jq -r --arg email "$ALERT_EMAIL" \
    'first((.notificationChannels // [])[] | select(.type == "email" and .labels.email_address == $email) | .name) // empty') ||
    return 1
  if [ -z "$name" ]; then
    name=$(monitoring_api -X POST "$api" -d "$(jq -nc --arg email "$ALERT_EMAIL" \
      '{type: "email", displayName: "방송팀 운영 알림", labels: {email_address: $email}}')" | jq -r .name) ||
      return 1
  fi
  echo "$name"
}

apply_metrics() {
  local file name verb
  for file in "${HERE}"/metrics/*.json; do
    name=$(basename "$file" .json)
    if gcloud logging metrics describe "$name" >/dev/null 2>&1; then verb=update; else verb=create; fi
    gcloud logging metrics "$verb" "$name" --config-from-file="$file"
  done
}

uptime_check_name() {
  gcloud monitoring uptime list-configs --filter="displayName=\"${UPTIME_NAME}\"" --limit=1 --format='value(name)'
}

apply_uptime_check() {
  local name
  name=$(uptime_check_name) || return 1
  if [ -z "$name" ]; then
    gcloud monitoring uptime create "$UPTIME_NAME" \
      --resource-type=uptime-url --resource-labels="host=${DOMAIN},project_id=${PROJECT_ID}" \
      --protocol=https --path=/api/health --matcher-content='"status":"ok"' \
      --period=5 --timeout=10 --regions=asia-pacific,europe,usa-oregon || return 1
    name=$(uptime_check_name) || return 1
  fi
  if [ -z "$name" ]; then
    log "가동 확인을 찾지 못했습니다: ${UPTIME_NAME}"
    return 1
  fi
  echo "${name##*/}"
}

apply_policies() {
  local channel=$1 check_id=$2 file display rendered existing
  for file in "${HERE}"/policies/*.json; do
    rendered="${WORK}/$(basename "$file")"
    sed -e "s/__SERVICE__/${SERVICE}/g" -e "s/__CHECK_ID__/${check_id}/g" "$file" >"$rendered"
    display=$(jq -r .displayName "$file")
    existing=$(gcloud monitoring policies list --filter="displayName=\"${display}\"" --limit=1 --format='value(name)')
    if [ -n "$existing" ]; then
      retry gcloud monitoring policies update "$existing" --policy-from-file="$rendered" \
        --set-notification-channels="$channel"
    else
      retry gcloud monitoring policies create --policy-from-file="$rendered" \
        --notification-channels="$channel"
    fi
  done
}

apply_budget() {
  local channel=$1 account existing number
  account=${BILLING_ACCOUNT:-$(gcloud billing projects describe "$PROJECT_ID" --format='value(billingAccountName)')}
  account=${account#billingAccounts/}
  existing=$(gcloud billing budgets list --billing-account="$account" \
    --filter="displayName=\"${BUDGET_NAME}\"" --limit=1 --format='value(name)')
  if [ -n "$existing" ]; then
    log "예산이 이미 있습니다: ${BUDGET_NAME}"
    return
  fi
  number=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')
  gcloud billing budgets create --billing-account="$account" --display-name="$BUDGET_NAME" \
    --budget-amount="$BUDGET_AMOUNT" --calendar-period=month --filter-projects="projects/${number}" \
    --threshold-rule=percent=0.5 --threshold-rule=percent=0.9 --threshold-rule=percent=1.0 \
    --threshold-rule=percent=1.0,basis=forecasted-spend \
    --notifications-rule-monitoring-notification-channels="$channel"
}

gcloud services enable monitoring.googleapis.com logging.googleapis.com \
  cloudbilling.googleapis.com billingbudgets.googleapis.com
TOKEN=$(gcloud auth print-access-token)
channel=$(notification_channel) || exit 1
if [[ $channel != projects/*/notificationChannels/* ]]; then
  log "알림 채널을 찾거나 만들지 못했습니다: ${channel}"
  exit 1
fi
apply_metrics
check_id=$(apply_uptime_check) || exit 1
apply_policies "$channel" "$check_id"
apply_budget "$channel"
log "적용을 마쳤습니다. 알림 채널: ${channel}"
