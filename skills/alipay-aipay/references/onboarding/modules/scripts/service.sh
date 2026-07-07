#!/bin/bash
#=============================================================================
# 脚本名称: service.sh
# 功能描述: 服务市场注册 - 查询已有服务 + 创建/修改服务
# 调用位置: Step 5.2 服务市场注册
# 调用前置: 脚本通过 error_handler.sh 间接初始化 DEV_TOOL_NAME；必要时可用 DEV_TOOL_NAME 环境变量覆盖
# 用法:
#   service list                                       - 查询已有服务列表
#   service save  --name <n> --desc <d> --url <u> --pricing <p> --schema <json> [--service-id <id>]
#   service validate --name <n> --desc <d> --url <u> --pricing <p> --schema <json>
# 返回值:
#   list:     输出服务列表表格 + FLOW:CREATE_NEW | FLOW:SELECT
#   save:     输出 ✅/❌ + serviceId（无 FLOW 标记，由 Agent 根据退出码判断）
#   validate: 输出 ✅/❌ + 校验详情（退出码 0=通过, 1=失败）
#=============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# 一次性 source error_handler（含 unwrap_mcp）
if [ -f "${SCRIPT_DIR}/error_handler.sh" ]; then
  source "${SCRIPT_DIR}/error_handler.sh"
else
  echo "❌ 缺少错误处理脚本: ${SCRIPT_DIR}/error_handler.sh"
  exit 1
fi

require_command jq || exit 1
require_command alipay-cli || exit 1
require_command awk || exit 1

# ─── service list: 查询已有服务 ──────────────────────────────────────────────
fetch_service_list() {
  RESULT=$(export PLATFORM=${DEV_TOOL_NAME} && alipay-cli mcp call a2a-pay-service.discoverBazaarServicesForMcp \
    -d '{"request":{"serviceStatus":"ACTIVE"}}' \
    --json 2>/dev/null)

  if ! handle_error "$RESULT"; then
    return 1
  fi

  BUSINESS=$(unwrap_mcp "$RESULT")
  SERVICE_LIST=$(echo "$BUSINESS" | jq -c '.resultObj.serviceList // []' 2>/dev/null)
  if [ -z "$SERVICE_LIST" ] || ! echo "$SERVICE_LIST" | jq -e 'type == "array"' >/dev/null 2>&1; then
    echo "❌ 服务列表返回结构异常，无法解析 serviceList"
    return 1
  fi

  SERVICE_COUNT=$(echo "$SERVICE_LIST" | jq 'length')
}

service_list() {
  if ! fetch_service_list; then
    exit 1
  fi

  if [ "$SERVICE_COUNT" -eq 0 ] || [ "$SERVICE_LIST" = "[]" ] || [ -z "$SERVICE_LIST" ]; then
    echo "📋 暂无服务上架，需要创建新服务"
    echo "FLOW:CREATE_NEW"
  else
    # 输出服务列表
    echo "📋 发现您已有以下服务："
    echo ""
    echo "| 序号 | 服务ID | 服务名称 | 描述 | 价格 | 状态 | 服务地址 |"
    echo "|------|--------|----------|------|------|------|----------|"

    for i in $(seq 0 $((SERVICE_COUNT-1))); do
      SERVICE=$(echo "$SERVICE_LIST" | jq ".[$i]")
      SERVICE_ID=$(echo "$SERVICE" | jq -r '.serviceId // "未知"')
      SERVICE_NAME=$(echo "$SERVICE" | jq -r '.serviceName // "未知"')
      SERVICE_DESC=$(echo "$SERVICE" | jq -r '.serviceDesc // "无描述"')
      PRICING=$(echo "$SERVICE" | jq -r '.pricing // "未知"')
      SERVICE_STATUS=$(echo "$SERVICE" | jq -r '.status // "未知"')
      RESOURCE_URL=$(echo "$SERVICE" | jq -r '.resourceUrl // "未知"')

      case "$SERVICE_STATUS" in
        "ONLINE") STATUS_CN="已上架" ;;
        "PENDING") STATUS_CN="审核中" ;;
        "REJECTED") STATUS_CN="审核拒绝" ;;
        *) STATUS_CN="$SERVICE_STATUS" ;;
      esac

      echo "| $((i+1)) | $SERVICE_ID | $SERVICE_NAME | $SERVICE_DESC | ${PRICING}元/次 | $STATUS_CN | $RESOURCE_URL |"
    done

    echo ""
    echo "请选择："
    echo "  • 输入序号（1-$SERVICE_COUNT）复用对应服务"
    echo "  • 输入\"新建\"创建新服务"
    echo "  • 输入\"修改\"修改已有服务"
    echo "FLOW:SELECT"
  fi
}

# ─── service save: 创建新服务 或 修改已有服务 ────────────────────────────────
service_save() {
  SERVICE_ID=""
  SERVICE_NAME=""
  SERVICE_DESC=""
  RESOURCE_URL=""
  PRICING=""
  SCHEMA_URL=""

  while [[ $# -gt 0 ]]; do
    case $1 in
      --service-id)    SERVICE_ID="$2"; shift 2 ;;
      --name)          SERVICE_NAME="$2"; shift 2 ;;
      --desc)          SERVICE_DESC="$2"; shift 2 ;;
      --url)           RESOURCE_URL="$2"; shift 2 ;;
      --pricing)       PRICING="$2"; shift 2 ;;
      --schema)        SCHEMA_URL="$2"; shift 2 ;;
      *) echo "❌ 未知参数: $1"; exit 1 ;;
    esac
  done

  if [ -z "$SERVICE_NAME" ] || [ -z "$SERVICE_DESC" ] || [ -z "$RESOURCE_URL" ] || [ -z "$PRICING" ] || [ -z "$SCHEMA_URL" ]; then
    echo "❌ 缺少必填参数"
    echo "用法（创建）: bash service.sh save --name <name> --desc <desc> --url <url> --pricing <pricing> --schema <json>"
    echo "用法（修改）: bash service.sh save --service-id <id> --name <name> --desc <desc> --url <url> --pricing <pricing> --schema <json>"
    exit 1
  fi

  if [ -z "$SERVICE_ID" ]; then
    # 创建新服务（不传 serviceId）
    if ! fetch_service_list; then
      exit 1
    fi
    if [ "$SERVICE_COUNT" -ge 20 ]; then
      echo "❌ 已达到服务数量上限（20个），无法创建新服务"
      echo "📋 您当前已有 $SERVICE_COUNT 个服务，请选择复用已有服务或修改已有服务"
      exit 1
    fi

    REQUEST_JSON=$(jq -n \
      --arg serviceName "$SERVICE_NAME" \
      --arg serviceDesc "$SERVICE_DESC" \
      --arg resourceUrl "$RESOURCE_URL" \
      --arg pricing "$PRICING" \
      --arg schemaUrl "$SCHEMA_URL" \
      '{request:{serviceName:$serviceName,serviceDesc:$serviceDesc,resourceUrl:$resourceUrl,pricing:$pricing,schemaUrl:$schemaUrl}}')

    RESULT=$(export PLATFORM=${DEV_TOOL_NAME} && alipay-cli mcp call a2a-pay-service.saveBazaarServiceForMcp \
      -d "$REQUEST_JSON" \
      --json 2>/dev/null)
  else
    # 修改已有服务（必须传入 serviceId + 所有字段）
    REQUEST_JSON=$(jq -n \
      --arg serviceId "$SERVICE_ID" \
      --arg serviceName "$SERVICE_NAME" \
      --arg serviceDesc "$SERVICE_DESC" \
      --arg resourceUrl "$RESOURCE_URL" \
      --arg pricing "$PRICING" \
      --arg schemaUrl "$SCHEMA_URL" \
      '{request:{serviceId:$serviceId,serviceName:$serviceName,serviceDesc:$serviceDesc,resourceUrl:$resourceUrl,pricing:$pricing,schemaUrl:$schemaUrl}}')

    RESULT=$(export PLATFORM=${DEV_TOOL_NAME} && alipay-cli mcp call a2a-pay-service.saveBazaarServiceForMcp \
      -d "$REQUEST_JSON" \
      --json 2>/dev/null)
  fi

  # 错误检测
  if ! handle_error "$RESULT"; then
    exit 1
  fi

  # 解包 MCP 信封后解析业务字段
  BUSINESS=$(unwrap_mcp "$RESULT")
  SUCCESS=$(echo "$BUSINESS" | jq -r '.success // false')

  if [ "$SUCCESS" = "true" ]; then
    OPERATION="上架"
    if [ -n "$SERVICE_ID" ]; then
      OPERATION="修改"
    fi
    # 使用 --arg 安全拼接回退值
    NEW_SERVICE_ID=$(echo "$BUSINESS" | jq -r --arg fallback "${SERVICE_ID}" '.resultObj.serviceId // $fallback')
    echo "✅ 服务${OPERATION}成功"
    echo "📋 服务ID: $NEW_SERVICE_ID"
  else
    ERROR_MSG=$(echo "$BUSINESS" | jq -r '.error.message // .errorMessage // "未知错误"')
    OPERATION="上架"
    if [ -n "$SERVICE_ID" ]; then
      OPERATION="修改"
    fi
    echo "❌ 服务${OPERATION}失败: $ERROR_MSG"
    exit 1
  fi
}

# ─── service validate: 入参校验 ──────────────────────────────────────────────
service_validate() {
  SERVICE_NAME=""
  SERVICE_DESC=""
  RESOURCE_URL=""
  PRICING=""
  SCHEMA_URL=""

  while [[ $# -gt 0 ]]; do
    case $1 in
      --name)    SERVICE_NAME="$2"; shift 2 ;;
      --desc)    SERVICE_DESC="$2"; shift 2 ;;
      --url)     RESOURCE_URL="$2"; shift 2 ;;
      --pricing) PRICING="$2"; shift 2 ;;
      --schema)  SCHEMA_URL="$2"; shift 2 ;;
      *) echo "❌ 未知参数: $1"; exit 1 ;;
    esac
  done

  # 1. 服务名称：长度 1-50 字符
  if [ -z "$SERVICE_NAME" ] || [ ${#SERVICE_NAME} -gt 50 ]; then
    echo "❌ 服务名称长度需在 1-50 字符之间（当前长度: ${#SERVICE_NAME}）"
    exit 1
  fi

  # 2. 服务描述：长度 1-500 字符
  if [ -z "$SERVICE_DESC" ] || [ ${#SERVICE_DESC} -gt 500 ]; then
    echo "❌ 服务描述长度需在 1-500 字符之间（当前长度: ${#SERVICE_DESC}）"
    exit 1
  fi

  # 3. 服务地址：有效 URL
  if [ -z "$RESOURCE_URL" ] || ! [[ "$RESOURCE_URL" =~ ^https?:// ]]; then
    echo "❌ 请提供有效的 URL 地址（以 http:// 或 https:// 开头）"
    exit 1
  fi

  # 4. 服务单价：数字格式，>= 0.01
  if [ -z "$PRICING" ] || ! [[ "$PRICING" =~ ^[0-9]+(\.[0-9]+)?$ ]]; then
    echo "❌ 服务单价格式不正确，请输入数字（如 0.01、1.00）"
    exit 1
  fi
  PRICING_VALID=$(awk -v p="$PRICING" 'BEGIN { if (p + 0 >= 0.01) print "true"; else print "false" }')
  if [ "$PRICING_VALID" = "false" ]; then
    echo "❌ 服务单价最低为 0.01 元"
    exit 1
  fi

  # 5. 请求示例：有效 JSON（改用 jq 代替 python3，与脚本其他部分保持一致）
  if [ -z "$SCHEMA_URL" ] || ! echo "$SCHEMA_URL" | jq . >/dev/null 2>&1; then
    echo "❌ 请提供有效的 JSON 格式请求示例"
    exit 1
  fi

  echo "✅ 服务信息校验通过"
}

# ─── 入口分发 ────────────────────────────────────────────────────────────────
case "${1:-}" in
  list)
    service_list
    ;;
  save)
    shift
    service_save "$@"
    ;;
  validate)
    shift
    service_validate "$@"
    ;;
  *)
    echo "用法: bash service.sh <list|save|validate> [参数...]"
    echo ""
    echo "  service list"
    echo "  service save    --name <n> --desc <d> --url <u> --pricing <p> --schema <json> [--service-id <id>]"
    echo "  service validate --name <n> --desc <d> --url <u> --pricing <p> --schema <json>"
    exit 1
    ;;
esac
