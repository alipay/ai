#!/bin/bash

set -u

MODE="${1:-}"
if [ "$MODE" != "check" ] && [ "$MODE" != "integration-check" ]; then
  echo "用法: bash alipay_cli_env.sh <check|integration-check> [--product-type aipay|webpay|apppay]" >&2
  exit 1
fi
shift

case "${BASH_SOURCE[0]}" in
  */*) SCRIPT_DIR="${BASH_SOURCE[0]%/*}" ;;
  *) SCRIPT_DIR="." ;;
esac
# shellcheck source=/dev/null
source "${SCRIPT_DIR}/common.sh"

PRODUCT_TYPE=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --product-type)
      [ "$#" -ge 2 ] || { echo "❌ 缺少参数值: $1" >&2; exit 1; }
      PRODUCT_TYPE="$2"
      shift 2
      ;;
    *)
      echo "❌ 未知参数: $1" >&2
      exit 1
      ;;
  esac
done

if [ -n "$PRODUCT_TYPE" ]; then
  init_alipay_cli_product "$PRODUCT_TYPE" || exit 1
else
  unset PRODUCT
fi

MISSING=()
command -v node >/dev/null 2>&1 || MISSING+=("node")
if ! command -v jq >/dev/null 2>&1 \
  || ! jq --version >/dev/null 2>&1 \
  || ! jq -n -e --arg value ok '$value == "ok"' >/dev/null 2>&1; then
  MISSING+=("jq")
fi
if ! command -v alipay-cli >/dev/null 2>&1 || ! alipay-cli version >/dev/null 2>&1; then
  MISSING+=("alipay-cli")
fi

if [ "${#MISSING[@]}" -eq 0 ]; then
  echo "CLI_ENV:READY"
else
  printf 'CLI_ENV:NEEDS_SETUP\nCLI_ENV_MISSING=%s\n' "$(IFS=,; echo "${MISSING[*]}")"
fi
