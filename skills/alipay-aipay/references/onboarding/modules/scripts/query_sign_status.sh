#!/bin/bash
#=============================================================================
# 脚本名称: query_sign_status.sh
# 功能描述: 查询签约状态并根据结果判断后续流程
# 调用位置: Step 3.1 状态与资源查询
# 调用前置: 脚本通过 error_handler.sh 间接初始化 DEV_TOOL_NAME/PLATFORM_ID；需传入 --sales-code，或兼容使用 SALES_CODE 环境变量
# 用法: bash query_sign_status.sh --sales-code <code> [--product-type aipay|webpay|apppay]
# 返回值: 在 stderr 输出签约状态控制信号；stdout 只保留受控错误正文
#           SIGN_STATUS=NOT_SIGNED | SIGN_STATUS=SIGNED_EFFECTIVE | SIGN_STATUS=SIGN_SUBMITTED | SIGN_STATUS=OTHER_STATUS
#           AI 按量付费:   FLOW:AI_PAY_NOT_SIGNED | FLOW:AI_PAY_SIGNED
#           AI 网页应用收款:   FLOW:PC_WEB_NOT_SIGNED  | FLOW:PC_WEB_SIGNED
#           AI 移动应用收款:    FLOW:APP_NOT_SIGNED     | FLOW:APP_SIGNED
#=============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# 一次性 source error_handler（含 unwrap_mcp）
if [ -f "${SCRIPT_DIR}/error_handler.sh" ]; then
  source "${SCRIPT_DIR}/error_handler.sh"
else
  echo "❌ 缺少错误处理脚本: ${SCRIPT_DIR}/error_handler.sh"
  exit 1
fi
source "${SCRIPT_DIR}/network_retry.sh"
source "${SCRIPT_DIR}/sign_status_parser.sh"

require_command jq || exit 1
require_command alipay-cli || exit 1

export PRODUCT_TYPE="${PRODUCT_TYPE:-unknown}"

while [[ $# -gt 0 ]]; do
  case $1 in
    --sales-code)
      [ $# -ge 2 ] || { echo "❌ 缺少参数值: $1"; exit 1; }
      SALES_CODE="$2"; shift 2 ;;
    --product-type)
      [ $# -ge 2 ] || { echo "❌ 缺少参数值: $1"; exit 1; }
      PRODUCT_TYPE="$2"; shift 2 ;;
    *)
      echo "❌ 未知参数: $1"
      echo "用法: bash query_sign_status.sh --sales-code <code> [--product-type aipay|webpay|apppay]"
      exit 1 ;;
  esac
done

if [ -z "$SALES_CODE" ]; then
  echo "❌ 缺少 salesCode（请传入 --sales-code，或设置 SALES_CODE 环境变量）"
  exit 1
fi

case "$SALES_CODE" in
  "I1080300001000160457")
    EXPECTED_PRODUCT_TYPE="aipay"
    ;;
  "I1080300001000041203")
    EXPECTED_PRODUCT_TYPE="webpay"
    ;;
  "I1080300001000041313")
    EXPECTED_PRODUCT_TYPE="apppay"
    ;;
  *)
    echo "❌ 未知 SALES_CODE: ${SALES_CODE}"
    exit 1
    ;;
esac

if [ "$PRODUCT_TYPE" != "unknown" ] && [ "$PRODUCT_TYPE" != "$EXPECTED_PRODUCT_TYPE" ]; then
  echo "❌ PRODUCT_TYPE 与 SALES_CODE 不匹配：PRODUCT_TYPE=${PRODUCT_TYPE}, SALES_CODE=${SALES_CODE}"
  echo "📋 期望 PRODUCT_TYPE=${EXPECTED_PRODUCT_TYPE}"
  exit 1
fi

init_alipay_cli_product "$EXPECTED_PRODUCT_TYPE" || exit 1

# 查询签约状态
require_alipay_cli_local_state_access_or_emit || exit "$?"
export PLATFORM="${DEV_TOOL_NAME}" PLATFORM_ID="${PLATFORM_ID:-}"
run_network_retry RESULT read query_sign_status -- alipay-cli mcp call ar-query.queryArInfosBySalesProd \
  -d "{\"request\":{\"salesProductCodes\":[\"${SALES_CODE}\"]},\"ctx\":{}}" \
  --json
RETRY_RC=$?
if [ "$RETRY_RC" -eq "${ALIPAY_CLI_LOCAL_STATE_PERMISSION_EXIT_CODE:-77}" ]; then
  exit "$RETRY_RC"
fi
if [ "$RETRY_RC" -ne 0 ]; then
  echo "❌ 签约状态查询因网络或服务异常在自动重试两次后仍未恢复"
  exit 1
fi

# 错误检测
if ! handle_error "$RESULT" "MCP_AUTHENTICATED_CALL"; then
  exit 1
fi

# 解包 MCP 信封后解析业务字段
BUSINESS=$(unwrap_mcp "$RESULT")

# 只有明确返回数组才可判断签约状态；缺少字段必须阻断，避免误判为未签约。
if ! SIGN_STATUS_OUTPUT=$(emit_sign_status_from_business "$BUSINESS" "$SALES_CODE"); then
  echo "❌ 签约状态返回结构异常，无法解析 arInfoList"
  exit 1
fi
printf '%s\n' "$SIGN_STATUS_OUTPUT" \
  | while IFS= read -r marker; do emit_control "$marker"; done
