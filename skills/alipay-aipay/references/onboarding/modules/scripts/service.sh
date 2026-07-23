#!/bin/bash
#=============================================================================
# 脚本名称: service.sh
# 功能描述: 服务市场注册 - 查询已有服务 + 创建/修改服务
# 调用位置: list 用于 Step 3.1 前置资源查询；save/validate 用于 Step 5.2 服务市场注册
# 调用前置: 脚本通过 error_handler.sh 间接初始化 DEV_TOOL_NAME；必要时可用 DEV_TOOL_NAME 环境变量覆盖
# 用法:
#   service list                                       - 查询已有服务列表
#   service save  --name <n> --desc <d> --url <u> --pricing <p> --schema <json> [--service-id <id>]
#   service validate --name <n> --desc <d> --url <u> --pricing <p> --schema <json>
# 返回值:
#   list:     输出服务列表 + SERVICE_CANDIDATE_ID + FLOW:CREATE_NEW | FLOW:SELECT
#   save:     输出 ✅/❌ + 实际解析到的 SERVICE_ID（不接受 Agent 自填）
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
source "${SCRIPT_DIR}/network_retry.sh"

require_command jq || exit 1
require_command alipay-cli || exit 1
require_command awk || exit 1

SERVICE_LIST_PAGE_LIMIT=10
SERVICE_CREATE_LIMIT=10

sanitize_candidate_cell() {
  jq -nr --arg value "${1:-}" '
    $value
    | gsub("[\u0000-\u001f\u007f]"; " ")
    | gsub("\\|"; "\\|")
  '
}

normalize_service_pricing() {
  local raw="$1"
  local pricing_pattern='^ *([0-9]+([.][0-9]+)?) *(元/次)? *$'
  SERVICE_PRICING_NORMALIZED=""
  case "$raw" in *$'\n'*|*$'\r'*|*$'\t'*) return 1 ;; esac
  if [[ "$raw" =~ $pricing_pattern ]]; then
    SERVICE_PRICING_NORMALIZED="${BASH_REMATCH[1]}"
    return 0
  fi
  return 1
}

validate_service_fields() {
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

  # 4. 服务单价：提交值统一规范化为纯数字，模板负责追加“元/次”。
  if [ -z "$PRICING" ] || ! normalize_service_pricing "$PRICING"; then
    echo "❌ 服务单价格式不正确，请输入数字金额（如 0.01、1.00）；模板会追加“元/次”单位"
    exit 1
  fi
  PRICING="$SERVICE_PRICING_NORMALIZED"
  PRICING_VALID=$(awk -v p="$PRICING" 'BEGIN { if (p + 0 >= 0.01) print "true"; else print "false" }')
  if [ "$PRICING_VALID" = "false" ]; then
    echo "❌ 服务单价最低为 0.01 元"
    exit 1
  fi

  # 5. schemaUrl 在本流程中承载序列化后的 JSON 请求示例，不是 URL。
  # CLI 接收原始 JSON；save 分支通过 jq --arg 将其安全写入字符串字段。
  if [ -z "$SCHEMA_URL" ] || ! echo "$SCHEMA_URL" | jq . >/dev/null 2>&1; then
    echo "❌ 请提供有效的 JSON 格式请求示例"
    exit 1
  fi
}

# ─── service list: 查询已有服务 ──────────────────────────────────────────────
fetch_service_page() {
  local OFFSET="$1"
  local LIMIT="$2"
  local REQUEST_JSON RESULT BUSINESS BUSINESS_CODE BUSINESS_MESSAGE

  REQUEST_JSON=$(jq -n \
    --argjson limit "$LIMIT" \
    --argjson offset "$OFFSET" \
    '{request:{limit:$limit,offset:$offset}}')

  export PLATFORM=${DEV_TOOL_NAME}
  run_network_retry RESULT read service_list_page -- alipay-cli mcp call a2a-pay-service.discoverBazaarServicesForMcp \
    -d "$REQUEST_JSON" \
    --json
  RETRY_RC=$?
  if [ "$RETRY_RC" -ne 0 ]; then
    echo "❌ 服务列表当前分页因网络或服务异常在自动重试两次后仍未恢复"
    return 1
  fi

  if ! handle_error "$RESULT"; then
    return 1
  fi

  BUSINESS=$(unwrap_mcp "$RESULT")

  BUSINESS_CODE=$(echo "$BUSINESS" | jq -r 'if has("code") then (.code | tostring) else "" end' 2>/dev/null)
  if [ -n "$BUSINESS_CODE" ] && [ "$BUSINESS_CODE" != "10000" ]; then
    BUSINESS_MESSAGE=$(echo "$BUSINESS" | jq -r '
      .subMsg // .data.subMsg // .msg // .data.msg // "未知错误"
    ' 2>/dev/null)
    BUSINESS_MESSAGE=$(sanitize_customer_error_text "$BUSINESS_MESSAGE")
    echo "❌ 查询服务列表失败: ${BUSINESS_CODE} / ${BUSINESS_MESSAGE}"
    return 1
  fi

  PAGE_FORMAT=$(echo "$BUSINESS" | jq -r '
    if ((.code | tostring) == "10000") and
       ((.data | type) == "object") and
       ((.data.items | type) == "array") and
       ((.data.pagination | type) == "object") and
       ((.data.pagination.total | type) == "number") and
       (.data.pagination.total >= 0) and
       ((.data.pagination.total | floor) == .data.pagination.total) and
       ((.data.pagination.offset | type) == "number") and
       (.data.pagination.offset >= 0) and
       ((.data.pagination.offset | floor) == .data.pagination.offset) then
      "current"
    elif (.success == true) and
         ((.resultObj | type) == "object") and
         ((.resultObj.serviceList | type) == "array") then
      "legacy"
    else
      "invalid"
    end
  ' 2>/dev/null)

  case "$PAGE_FORMAT" in
    current)
      PAGE_ITEMS=$(echo "$BUSINESS" | jq -c '.data.items')
      PAGE_TOTAL=$(echo "$BUSINESS" | jq -r '.data.pagination.total')
      PAGE_OFFSET=$(echo "$BUSINESS" | jq -r '.data.pagination.offset')
      ;;
    legacy)
      PAGE_ITEMS=$(echo "$BUSINESS" | jq -c '.resultObj.serviceList')
      PAGE_TOTAL=$(echo "$PAGE_ITEMS" | jq 'length')
      PAGE_OFFSET=0
      ;;
    *)
      echo "❌ 服务列表返回结构异常，无法解析 data.items 或兼容的 resultObj.serviceList"
      return 1
      ;;
  esac

  if [ -z "$PAGE_ITEMS" ] || ! echo "$PAGE_ITEMS" | jq -e 'type == "array"' >/dev/null 2>&1; then
    echo "❌ 服务列表返回结构异常，列表字段不是数组"
    return 1
  fi
}

fetch_service_list() {
  local LIMIT="$SERVICE_LIST_PAGE_LIMIT"
  local OFFSET=0
  local EXPECTED_TOTAL=""
  local PAGE_COUNT

  SERVICE_LIST='[]'

  while true; do
    if ! fetch_service_page "$OFFSET" "$LIMIT"; then
      return 1
    fi

    if [ "$PAGE_FORMAT" = "legacy" ]; then
      SERVICE_LIST="$PAGE_ITEMS"
      break
    fi

    if [ "$PAGE_OFFSET" -ne "$OFFSET" ]; then
      echo "❌ 服务列表分页返回异常：期望 offset=${OFFSET}，实际 offset=${PAGE_OFFSET}"
      return 1
    fi

    if [ -z "$EXPECTED_TOTAL" ]; then
      EXPECTED_TOTAL="$PAGE_TOTAL"
    elif [ "$PAGE_TOTAL" -ne "$EXPECTED_TOTAL" ]; then
      echo "❌ 服务列表分页返回异常：分页过程中 total 发生变化"
      return 1
    fi

    SERVICE_LIST=$(jq -cn \
      --argjson existing "$SERVICE_LIST" \
      --argjson page "$PAGE_ITEMS" \
      '$existing + $page')
    SERVICE_COUNT=$(echo "$SERVICE_LIST" | jq 'length')

    if [ "$SERVICE_COUNT" -gt "$EXPECTED_TOTAL" ]; then
      echo "❌ 服务列表分页返回异常：已返回数量超过 total"
      return 1
    fi
    if [ "$SERVICE_COUNT" -eq "$EXPECTED_TOTAL" ]; then
      break
    fi

    PAGE_COUNT=$(echo "$PAGE_ITEMS" | jq 'length')
    if [ "$PAGE_COUNT" -eq 0 ]; then
      echo "❌ 服务列表分页返回异常：尚有未返回数据但当前页为空"
      return 1
    fi
    OFFSET="$SERVICE_COUNT"
  done

  if ! echo "$SERVICE_LIST" | jq -e '
    all(.[];
      ((.serviceId | type) == "string") and
      (.serviceId | length > 0) and
      ((.serviceId | test("[\u0000-\u001f\u007f]") | not))
    )
  ' >/dev/null 2>&1; then
    echo "❌ 服务列表返回结构异常：候选 serviceId 缺失或包含控制字符"
    return 1
  fi

  SERVICE_COUNT=$(echo "$SERVICE_LIST" | jq 'length')
}

service_list() {
  if ! fetch_service_list; then
    exit 1
  fi

  if [ "$SERVICE_COUNT" -eq 0 ] || [ "$SERVICE_LIST" = "[]" ] || [ -z "$SERVICE_LIST" ]; then
    echo "📋 暂无已有服务。"
    echo "FLOW:CREATE_NEW"
  else
    echo "📋 发现您已有以下服务："
    echo ""
    echo "| 服务ID | 服务名称 | 描述 | 价格 | 实际状态 | 服务地址 |"
    echo "|--------|----------|------|------|----------|----------|"

    for i in $(seq 0 $((SERVICE_COUNT-1))); do
      SERVICE=$(echo "$SERVICE_LIST" | jq ".[$i]")
      SERVICE_ID=$(echo "$SERVICE" | jq -r '.serviceId')
      SERVICE_NAME=$(echo "$SERVICE" | jq -r '(.serviceName // "未知") | tostring')
      SERVICE_DESC=$(echo "$SERVICE" | jq -r '(.serviceDesc // "无描述") | tostring')
      PRICING=$(echo "$SERVICE" | jq -r '(.pricing // "未知") | tostring')
      SERVICE_STATUS=$(echo "$SERVICE" | jq -r '(.serviceStatus // .status // "未知") | tostring')
      RESOURCE_URL=$(echo "$SERVICE" | jq -r '(.resourceUrl // "未知") | tostring')

      case "$SERVICE_STATUS" in
        "ACTIVE") STATUS_CN="已上线" ;;
        "PENDING") STATUS_CN="审核中" ;;
        "REJECTED") STATUS_CN="审核拒绝" ;;
        *) STATUS_CN="$SERVICE_STATUS" ;;
      esac

      SERVICE_ID_DISPLAY=$(sanitize_candidate_cell "$SERVICE_ID")
      SERVICE_NAME=$(sanitize_candidate_cell "$SERVICE_NAME")
      SERVICE_DESC=$(sanitize_candidate_cell "$SERVICE_DESC")
      PRICING=$(sanitize_candidate_cell "$PRICING")
      STATUS_CN=$(sanitize_candidate_cell "$STATUS_CN")
      RESOURCE_URL=$(sanitize_candidate_cell "$RESOURCE_URL")
      echo "| $SERVICE_ID_DISPLAY | $SERVICE_NAME | $SERVICE_DESC | ${PRICING}元/次 | $STATUS_CN | $RESOURCE_URL |"
    done

    echo "$SERVICE_LIST" | jq -r '.[] | "SERVICE_CANDIDATE_ID=" + .serviceId'

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
      --service-id)
        [ $# -ge 2 ] || { echo "❌ 缺少参数值: $1"; exit 1; }
        SERVICE_ID="$2"; shift 2 ;;
      --name)
        [ $# -ge 2 ] || { echo "❌ 缺少参数值: $1"; exit 1; }
        SERVICE_NAME="$2"; shift 2 ;;
      --desc)
        [ $# -ge 2 ] || { echo "❌ 缺少参数值: $1"; exit 1; }
        SERVICE_DESC="$2"; shift 2 ;;
      --url)
        [ $# -ge 2 ] || { echo "❌ 缺少参数值: $1"; exit 1; }
        RESOURCE_URL="$2"; shift 2 ;;
      --pricing)
        [ $# -ge 2 ] || { echo "❌ 缺少参数值: $1"; exit 1; }
        PRICING="$2"; shift 2 ;;
      --schema)
        [ $# -ge 2 ] || { echo "❌ 缺少参数值: $1"; exit 1; }
        SCHEMA_URL="$2"; shift 2 ;;
      *) echo "❌ 未知参数: $1"; exit 1 ;;
    esac
  done

  if [ -z "$SERVICE_NAME" ] || [ -z "$SERVICE_DESC" ] || [ -z "$RESOURCE_URL" ] || [ -z "$PRICING" ] || [ -z "$SCHEMA_URL" ]; then
    echo "❌ 缺少必填参数"
    echo "用法（创建）: bash service.sh save --name <name> --desc <desc> --url <url> --pricing <pricing> --schema <json>"
    echo "用法（修改）: bash service.sh save --service-id <id> --name <name> --desc <desc> --url <url> --pricing <pricing> --schema <json>"
    exit 1
  fi
  validate_service_fields

  if [ -z "$SERVICE_ID" ]; then
    # 创建新服务（不传 serviceId）
    if ! fetch_service_list; then
      exit 1
    fi
    if [ "$SERVICE_COUNT" -ge "$SERVICE_CREATE_LIMIT" ]; then
      echo "❌ 已达到服务数量上限（${SERVICE_CREATE_LIMIT}个），无法创建新服务"
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

  fi

  export PLATFORM=${DEV_TOOL_NAME}
  run_network_retry RESULT write service_save -- alipay-cli mcp call a2a-pay-service.saveBazaarServiceForMcp \
    -d "$REQUEST_JSON" \
    --json
  RETRY_RC=$?
  if [ "$RETRY_RC" -eq 75 ]; then
    if [ -z "$SERVICE_ID" ]; then
      echo "❌ 服务创建响应不明；现有查询无法把同名候选唯一归属于本次创建，结果标记为 UNKNOWN，禁止自动重复创建"
      exit 1
    fi
    if fetch_service_list; then
      MATCH_COUNT=$(echo "$SERVICE_LIST" | jq --arg id "$SERVICE_ID" --arg name "$SERVICE_NAME" --arg desc "$SERVICE_DESC" --arg url "$RESOURCE_URL" --arg pricing "$PRICING" --arg schema "$SCHEMA_URL" '
        [.[] | select(
          .serviceId == $id and .serviceName == $name and .serviceDesc == $desc and
          .resourceUrl == $url and (.pricing | tostring) == $pricing and .schemaUrl == $schema
        )] | length
      ')
      if [ "$MATCH_COUNT" -eq 1 ]; then
        echo "✅ 服务修改已由列表查询核验成功"
        echo "📋 服务ID: $SERVICE_ID"
        echo "SERVICE_ID=$SERVICE_ID"
        return 0
      fi
    fi
    echo "❌ 服务修改响应不明且现有列表无法排除传播延迟，结果标记为 UNKNOWN，禁止自动重复修改"
    exit 1
  elif [ "$RETRY_RC" -ne 0 ]; then
    if [ -z "$SERVICE_ID" ]; then
      echo "❌ 服务创建因明确未发送的网络异常在自动重试两次后仍未恢复"
    else
      echo "❌ 服务修改因明确未发送的网络异常在自动重试两次后仍未恢复"
    fi
    exit 1
  fi

  # 错误检测
  if ! handle_error "$RESULT"; then
    exit 1
  fi

  # 解包 MCP 信封后按当前协议解析，并兼容旧 success/resultObj 协议。
  BUSINESS=$(unwrap_mcp "$RESULT")
  SAVE_FORMAT=$(echo "$BUSINESS" | jq -r '
    if ((.code | tostring) == "10000") and
       ((.data | type) == "object") and
       (.data.success == true) then
      "current"
    elif (.success == true) and
         ((.resultObj | type) == "object") then
      "legacy"
    else
      "invalid"
    end
  ' 2>/dev/null)

  if [ "$SAVE_FORMAT" = "current" ] || [ "$SAVE_FORMAT" = "legacy" ]; then
    OPERATION="创建"
    if [ -n "$SERVICE_ID" ]; then
      OPERATION="修改"
    fi

    if [ "$SAVE_FORMAT" = "current" ]; then
      NEW_SERVICE_ID=$(echo "$BUSINESS" | jq -r --arg fallback "${SERVICE_ID}" '
        (.data.serviceId | select(type == "string" and length > 0)) // $fallback
      ')
    else
      NEW_SERVICE_ID=$(echo "$BUSINESS" | jq -r --arg fallback "${SERVICE_ID}" '
        (.resultObj.serviceId | select(type == "string" and length > 0)) // $fallback
      ')
    fi

    if [ -z "$NEW_SERVICE_ID" ]; then
      echo "❌ 服务创建返回成功，但未解析到 serviceId，禁止继续后续流程"
      exit 1
    fi
    echo "✅ 服务${OPERATION}成功"
    echo "📋 服务ID: $NEW_SERVICE_ID"
    echo "SERVICE_ID=$NEW_SERVICE_ID"
  else
    OPERATION="创建"
    if [ -n "$SERVICE_ID" ]; then
      OPERATION="修改"
    fi

    BUSINESS_CODE=$(echo "$BUSINESS" | jq -r 'if has("code") then (.code | tostring) else "" end' 2>/dev/null)
    if [ -n "$BUSINESS_CODE" ] && [ "$BUSINESS_CODE" != "10000" ]; then
      ERROR_MSG=$(echo "$BUSINESS" | jq -r '
        .data.subMsg // .data.msg // .subMsg // .msg //
        .error.message // .errorMessage // "未知错误"
      ' 2>/dev/null)
      ERROR_MSG=$(sanitize_customer_error_text "$ERROR_MSG")
      echo "❌ 服务${OPERATION}失败: ${BUSINESS_CODE} / ${ERROR_MSG}"
    else
      echo "❌ 服务${OPERATION}返回结构异常，无法确认操作结果"
    fi
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
      --name)
        [ $# -ge 2 ] || { echo "❌ 缺少参数值: $1"; exit 1; }
        SERVICE_NAME="$2"; shift 2 ;;
      --desc)
        [ $# -ge 2 ] || { echo "❌ 缺少参数值: $1"; exit 1; }
        SERVICE_DESC="$2"; shift 2 ;;
      --url)
        [ $# -ge 2 ] || { echo "❌ 缺少参数值: $1"; exit 1; }
        RESOURCE_URL="$2"; shift 2 ;;
      --pricing)
        [ $# -ge 2 ] || { echo "❌ 缺少参数值: $1"; exit 1; }
        PRICING="$2"; shift 2 ;;
      --schema)
        [ $# -ge 2 ] || { echo "❌ 缺少参数值: $1"; exit 1; }
        SCHEMA_URL="$2"; shift 2 ;;
      *) echo "❌ 未知参数: $1"; exit 1 ;;
    esac
  done

  validate_service_fields

  echo "✅ 服务信息校验通过"
  echo "SERVICE_PRICING=$PRICING"
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
