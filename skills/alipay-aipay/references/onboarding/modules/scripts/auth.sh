#!/bin/bash
#=============================================================================
# 脚本名称: auth.sh
# 功能描述: 登录授权全流程 - 检查状态 + 执行登录 + 授权确认 + scope/MCC 校验 + 重新授权
# 调用位置: Step 3 登录授权
# 调用前置: 脚本通过 error_handler.sh 间接初始化 DEV_TOOL_NAME/PLATFORM_ID；必要时可用 DEV_TOOL_NAME 环境变量覆盖
# 用法:
#   auth init   --defer-open --scope <scope> --sales-code <code> --mcc-code <code> --product-name <name> --mcc-name <name> --mcc-context-receipt <receipt>
#   auth open   [--scope <scope> --sales-code <code> --mcc-code <code> --product-name <name> --mcc-name <name> --mcc-context-receipt <receipt>]
#   auth manual-open
#   auth confirm [--scope <scope> --sales-code <code> --mcc-code <code> --product-name <name> --mcc-name <name> --mcc-context-receipt <receipt>]
#   auth wait [--scope <scope> --sales-code <code> --mcc-code <code> --product-name <name> --mcc-name <name> --mcc-context-receipt <receipt>]
#   auth mismatch --defer-open [--scope <scope> --sales-code <code> --mcc-code <code> --product-name <name> --mcc-name <name> --mcc-context-receipt <receipt>]
# 返回值:
#   init:     AUTH_FLOW:SKIP | AUTH_FLOW:READY_TO_OPEN | AUTH_FLOW:SCOPE_MISMATCH | AUTH_FLOW:MCC_MISMATCH | AUTH_FLOW:RETRY_WITH_NETWORK | AUTH_FLOW:FAILED
#   wait:     AUTH_FLOW:AUTH_SUCCESS | AUTH_FLOW:PENDING | AUTH_FLOW:EXPIRED | AUTH_FLOW:SCOPE_MISMATCH | AUTH_FLOW:MCC_MISMATCH | AUTH_FLOW:CONTEXT_MISMATCH | AUTH_FLOW:RETRY_WITH_NETWORK | AUTH_FLOW:FAILED
#   confirm:  AUTH_FLOW:AUTH_SUCCESS | AUTH_FLOW:PENDING | AUTH_FLOW:EXPIRED | AUTH_FLOW:SCOPE_MISMATCH | AUTH_FLOW:MCC_MISMATCH | AUTH_FLOW:CONTEXT_MISMATCH | AUTH_FLOW:RETRY_WITH_NETWORK | AUTH_FLOW:FAILED
#   local fs: init/wait/confirm/mismatch 可返回 AUTH_FLOW:RETRY_WITH_LOCAL_FS_PERMISSION
#   mismatch: logout 后置条件可确认后调用 auth init 重新生成授权链接；上下文冲突时输出 AUTH_FLOW:CONTEXT_MISMATCH 且不 logout；无法确认 CLI 结果时输出 AUTH_FLOW:RETRY_WITH_NETWORK；仍处于登录态时输出 AUTH_FLOW:LOGOUT_STILL_LOGGED_IN
#   stdout:   仅登记对客正文；AUTH_FLOW/状态/查询复用标记写入 stderr
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
RENDERER="${SCRIPT_DIR}/../../../normal/scripts/render_customer_message.mjs"
AUTH_LOCAL_STATE_PERMISSION_EXIT_CODE="${ALIPAY_CLI_LOCAL_STATE_PERMISSION_EXIT_CODE:-77}"

require_command jq || exit 1
require_command alipay-cli || exit 1
require_command node || exit 1
require_command mktemp || exit 1
umask 077

auth_product_type_from_sales_code() {
  case "$1" in
    "I1080300001000160457") printf 'aipay' ;;
    "I1080300001000041203") printf 'webpay' ;;
    "I1080300001000041313") printf 'apppay' ;;
    *) return 1 ;;
  esac
}

create_auth_sign_reuse_receipt() {
  local sign_status="$1" sign_flow="$2" product_type payload encoded
  product_type=$(auth_product_type_from_sales_code "$SALES_CODE") || return 1
  payload=$(jq -cn \
    --arg productType "$product_type" \
    --arg salesCode "$SALES_CODE" \
    --arg signStatus "$sign_status" \
    --arg flow "$sign_flow" \
    '{schema_ver:1,product_type:$productType,sales_code:$salesCode,sign_status:$signStatus,flow:$flow}') || return 1
  encoded=$(printf '%s' "$payload" | jq -rR '@base64' | tr '+/' '-_' | tr -d '=\n') || return 1
  printf 'AIPAY_SIGN_REUSE_V1.%s' "$encoded"
}

# ─── 授权状态文件（用于独立执行 confirm/mismatch 时兜底恢复非敏感参数）────
AUTH_STATE_OWNER="$(id -u 2>/dev/null || printf '%s' "${USER:-unknown}" | tr -c 'A-Za-z0-9_-' '_')"
AUTH_STATE_BASE="${TMPDIR:-/tmp}"
AUTH_STATE_BASE="${AUTH_STATE_BASE%/}"
if [ -n "${ALIPAY_AUTH_STATE_FILE:-}" ]; then
  AUTH_STATE_FILE="$ALIPAY_AUTH_STATE_FILE"
  AUTH_STATE_DIR="$(dirname "$AUTH_STATE_FILE")"
  AUTH_STATE_DIR_MANAGED=false
else
  AUTH_STATE_DIR="${AUTH_STATE_BASE}/alipay-aipay-auth-${AUTH_STATE_OWNER}"
  AUTH_STATE_FILE="${AUTH_STATE_DIR}/state.json"
  AUTH_STATE_DIR_MANAGED=true
fi

secure_mode() {
  local target="$1" expected="$2" mode
  if mode=$(stat -f '%Lp' "$target" 2>/dev/null); then
    :
  elif mode=$(stat -c '%a' "$target" 2>/dev/null); then
    :
  else
    return 1
  fi
  [ "$mode" = "$expected" ]
}

prepare_auth_state_dir() {
  if [ "$AUTH_STATE_DIR_MANAGED" = true ]; then
    if [ -L "$AUTH_STATE_DIR" ] || { [ -e "$AUTH_STATE_DIR" ] && [ ! -d "$AUTH_STATE_DIR" ]; }; then
      echo "❌ 授权临时目录不安全，已停止" >&2
      return 1
    fi
    mkdir -p "$AUTH_STATE_DIR" || return 1
    chmod 700 "$AUTH_STATE_DIR" 2>/dev/null || return 1
    secure_mode "$AUTH_STATE_DIR" 700 || return 1
  else
    [ -d "$AUTH_STATE_DIR" ] && [ ! -L "$AUTH_STATE_DIR" ] || {
      echo "❌ 指定的授权状态目录不可用或不安全，已停止" >&2
      return 1
    }
  fi
}

validate_auth_state_file() {
  [ -f "$AUTH_STATE_FILE" ] && [ ! -L "$AUTH_STATE_FILE" ] || return 1
  chmod 600 "$AUTH_STATE_FILE" 2>/dev/null || return 1
  secure_mode "$AUTH_STATE_FILE" 600
}

cleanup_auth_state() {
  rm -f "$AUTH_STATE_FILE"
}

reset_auth_state_for_init() {
  local field current saved
  AUTH_INIT_CONTEXT_MISMATCH_TYPE=""
  [ -e "$AUTH_STATE_FILE" ] || [ -L "$AUTH_STATE_FILE" ] || return 0
  if ! prepare_auth_state_dir || ! validate_auth_state_file; then
    echo "❌ 授权状态文件不可用或不安全，已停止"
    emit_control "AUTH_FLOW:FAILED"
    return 1
  fi

  # 新上下文通过机器校验后才读取旧状态；只记录差异类型，不复用旧 deviceCode。
  if jq -e 'type == "object"' "$AUTH_STATE_FILE" >/dev/null 2>&1; then
    for field in salesCode scope productName mccCode mccName mccContextReceipt; do
      case "$field" in
        salesCode) current="$SALES_CODE" ;;
        scope) current="$SCOPE" ;;
        productName) current="$PRODUCT_NAME" ;;
        mccCode) current="$MCC_CODE" ;;
        mccName) current="$MCC_NAME" ;;
        mccContextReceipt) current="${MCC_CONTEXT_RECEIPT:-}" ;;
      esac
      saved=$(jq -r --arg field "$field" '.[$field] // ""' "$AUTH_STATE_FILE")
      if [ "$current" != "$saved" ]; then
        case "$field" in
          salesCode|scope|productName) AUTH_INIT_CONTEXT_MISMATCH_TYPE="SCOPE_MISMATCH" ;;
          *) [ -n "$AUTH_INIT_CONTEXT_MISMATCH_TYPE" ] || AUTH_INIT_CONTEXT_MISMATCH_TYPE="MCC_MISMATCH" ;;
        esac
      fi
    done
  else
    # 无法证明旧状态属于当前产品上下文时，已有登录也必须重新授权。
    AUTH_INIT_CONTEXT_MISMATCH_TYPE="SCOPE_MISMATCH"
  fi
  cleanup_auth_state
}

save_auth_state() {
  local temp_state
  prepare_auth_state_dir || return 1
  if [ -L "$AUTH_STATE_FILE" ] || { [ -e "$AUTH_STATE_FILE" ] && [ ! -f "$AUTH_STATE_FILE" ]; }; then
    echo "❌ 授权状态路径不是安全的普通文件，已停止" >&2
    return 1
  fi
  temp_state=$(mktemp "${AUTH_STATE_DIR}/.auth-state.XXXXXX") || return 1
  chmod 600 "$temp_state" 2>/dev/null || { rm -f "$temp_state"; return 1; }
  jq -n \
    --arg salesCode "$SALES_CODE" \
    --arg mccCode "$MCC_CODE" \
    --arg scope "$SCOPE" \
    --arg productName "${PRODUCT_NAME:-}" \
    --arg mccName "${MCC_NAME:-}" \
    --arg mccContextReceipt "${MCC_CONTEXT_RECEIPT:-}" \
    --arg deviceCode "${DEVICE_CODE:-}" \
    --arg authorizationUrl "${BROWSER_URL:-}" \
    '{
      salesCode: $salesCode,
      mccCode: $mccCode,
      scope: $scope,
      productName: $productName,
      mccName: $mccName,
      mccContextReceipt: $mccContextReceipt,
      deviceCode: $deviceCode,
      authorizationUrl: $authorizationUrl
    }' > "$temp_state" || { rm -f "$temp_state"; return 1; }
  mv "$temp_state" "$AUTH_STATE_FILE" || { rm -f "$temp_state"; return 1; }
  validate_auth_state_file || {
    cleanup_auth_state
    echo "❌ 无法确认授权状态文件权限为 0600，已停止" >&2
    return 1
  }
}

save_auth_state_after_page_delivery() {
  if save_auth_state; then
    return 0
  fi
  emit_control "AUTH_STATE:SAVE_FAILED"
  return 0
}

load_auth_state() {
  if ! validate_auth_state_file; then
    echo "❌ 缺少授权上下文（请传入 --sales-code/--mcc-code，或先执行 auth.sh init）"
    return 1
  fi
  if ! jq -e . "$AUTH_STATE_FILE" >/dev/null 2>&1; then
    echo "❌ 授权状态文件不是合法 JSON: $AUTH_STATE_FILE"
    echo "📋 请重新执行 auth.sh init 生成授权状态。"
    return 1
  fi

  [ -n "${SALES_CODE:-}" ] || SALES_CODE=$(jq -r '.salesCode // ""' "$AUTH_STATE_FILE")
  [ -n "${MCC_CODE:-}" ] || MCC_CODE=$(jq -r '.mccCode // ""' "$AUTH_STATE_FILE")
  [ -n "${SCOPE:-}" ] || SCOPE=$(jq -r '.scope // ""' "$AUTH_STATE_FILE")
  [ -n "${PRODUCT_NAME:-}" ] || PRODUCT_NAME=$(jq -r '.productName // ""' "$AUTH_STATE_FILE")
  [ -n "${MCC_NAME:-}" ] || MCC_NAME=$(jq -r '.mccName // ""' "$AUTH_STATE_FILE")
  [ -n "${MCC_CONTEXT_RECEIPT:-}" ] || MCC_CONTEXT_RECEIPT=$(jq -r '.mccContextReceipt // ""' "$AUTH_STATE_FILE")
}

verify_context_against_auth_state() {
  local field current saved
  [ -e "$AUTH_STATE_FILE" ] || [ -L "$AUTH_STATE_FILE" ] || return 0
  if ! validate_auth_state_file; then
    echo "❌ 授权状态文件不可用或不安全，已停止"
    return 1
  fi
  if ! jq -e . "$AUTH_STATE_FILE" >/dev/null 2>&1; then
    echo "❌ 授权状态文件不是合法 JSON: $AUTH_STATE_FILE"
    return 1
  fi
  for field in salesCode mccCode scope productName mccName mccContextReceipt; do
    case "$field" in
      salesCode) current="$SALES_CODE" ;;
      mccCode) current="$MCC_CODE" ;;
      scope) current="$SCOPE" ;;
      productName) current="$PRODUCT_NAME" ;;
      mccName) current="$MCC_NAME" ;;
      mccContextReceipt) current="${MCC_CONTEXT_RECEIPT:-}" ;;
    esac
    saved=$(jq -r --arg field "$field" '.[$field] // ""' "$AUTH_STATE_FILE")
    if [ -n "$current" ] && [ -n "$saved" ] && [ "$current" != "$saved" ]; then
      emit_control "AUTH_FLOW:CONTEXT_MISMATCH"
      return 1
    fi
  done
}

parse_auth_context_args() {
  while [[ $# -gt 0 ]]; do
    case $1 in
      --scope)
        [ $# -ge 2 ] || { echo "❌ 缺少参数值: $1"; return 1; }
        SCOPE="$2"; shift 2 ;;
      --sales-code)
        [ $# -ge 2 ] || { echo "❌ 缺少参数值: $1"; return 1; }
        SALES_CODE="$2"; shift 2 ;;
      --mcc-code)
        [ $# -ge 2 ] || { echo "❌ 缺少参数值: $1"; return 1; }
        MCC_CODE="$2"; shift 2 ;;
      --product-name)
        [ $# -ge 2 ] || { echo "❌ 缺少参数值: $1"; return 1; }
        PRODUCT_NAME="$2"; shift 2 ;;
      --mcc-name)
        [ $# -ge 2 ] || { echo "❌ 缺少参数值: $1"; return 1; }
        MCC_NAME="$2"; shift 2 ;;
      --mcc-context-receipt)
        [ $# -ge 2 ] || { echo "❌ 缺少参数值: $1"; return 1; }
        MCC_CONTEXT_RECEIPT="$2"; shift 2 ;;
      *) echo "❌ 未知参数: $1"; return 1 ;;
    esac
  done
}

restore_auth_context_or_state() {
  SCOPE="${SCOPE:-}"
  SALES_CODE="${SALES_CODE:-}"
  MCC_CODE="${MCC_CODE:-}"
  PRODUCT_NAME="${PRODUCT_NAME:-}"
  MCC_NAME="${MCC_NAME:-}"
  MCC_CONTEXT_RECEIPT="${MCC_CONTEXT_RECEIPT:-}"

  if [ "$#" -gt 0 ]; then
    parse_auth_context_args "$@" || return 1
  fi

  verify_context_against_auth_state || return 1
  if [ -e "$AUTH_STATE_FILE" ] || [ -L "$AUTH_STATE_FILE" ]; then
    load_auth_state || return 1
  elif [ -z "$SALES_CODE" ] || [ -z "$MCC_CODE" ] || [ -z "$PRODUCT_NAME" ] || [ -z "$MCC_NAME" ]; then
    load_auth_state || return 1
  fi

  if [ -z "$SCOPE" ]; then
    SCOPE=$(get_scope "$SALES_CODE")
  fi
  validate_auth_context || return 1
}

# ─── 共用：根据 salesCode 获取 scope ─────────────────────────────────────────
get_scope() {
  case "$1" in
    "I1080300001000041203") echo "app:all,fast_instant_trade_pay:write" ;;
    "I1080300001000041313") echo "app:all,auth_alipay_apppay:write" ;;
    "I1080300001000160457") echo "app:all,machine_pay:write,agmnt:write" ;;
    *) echo "" ;;
  esac
}

validate_auth_context() {
  local context_json
  context_json=$(jq -n \
    --arg productName "$PRODUCT_NAME" \
    --arg salesCode "$SALES_CODE" \
    --arg scope "$SCOPE" \
    --arg mccCode "$MCC_CODE" \
    --arg mccName "$MCC_NAME" \
    --arg mccContextReceipt "${MCC_CONTEXT_RECEIPT:-}" \
    '{productName:$productName,salesCode:$salesCode,scope:$scope,mccCode:$mccCode,mccName:$mccName,mccContextReceipt:$mccContextReceipt}') || return 1
  if ! printf '%s' "$context_json" | node "$RENDERER" --validate-authorization-context >/dev/null; then
    echo "❌ 授权上下文校验失败：产品、产品码、scope 或 MCC 不匹配当前固定规则"
    emit_control "AUTH_FLOW:FAILED"
    return 1
  fi
  init_alipay_cli_product_from_sales_code "$SALES_CODE" || {
    emit_control "AUTH_FLOW:FAILED"
    return 1
  }
}

build_authorization_url() {
  local input_json platform_value
  platform_value="${DEV_TOOL_NAME:-}"
  [ "$platform_value" = "unknown" ] && platform_value=""
  input_json=$(jq -n \
    --arg productName "$PRODUCT_NAME" \
    --arg salesCode "$SALES_CODE" \
    --arg scope "$SCOPE" \
    --arg mccCode "$MCC_CODE" \
    --arg mccName "$MCC_NAME" \
    --arg deviceCode "$DEVICE_CODE" \
    --arg platform "$platform_value" \
    --arg mccContextReceipt "${MCC_CONTEXT_RECEIPT:-}" \
    '{productName:$productName,salesCode:$salesCode,scope:$scope,mccCode:$mccCode,mccName:$mccName,mccContextReceipt:$mccContextReceipt,deviceCode:$deviceCode,platform:$platform}') || return 1
  printf '%s' "$input_json" | node "$RENDERER" --build-authorization-url
}

extract_json_payload() {
  local raw="$1"
  local analysis status
  analysis=$(extract_unique_json "$raw") || return 1
  status=$(printf '%s' "$analysis" | jq -r '.status // "none"' 2>/dev/null)
  [ "$status" = "ok" ] || return 1
  printf '%s' "$analysis" | jq -ce '.value | select(type == "object")' 2>/dev/null
}

auth_has_local_state_permission_error() {
  alipay_cli_has_local_state_permission_error "$1"
}

auth_local_state_permission_failure() {
  emit_control "AUTH_FLOW:RETRY_WITH_LOCAL_FS_PERMISSION"
}

auth_require_local_state_access() {
  require_alipay_cli_local_state_access || {
    auth_local_state_permission_failure
    return 1
  }
}

auth_cli_environment_failure() {
  local action="$1" failure_code="${2:-1}"
  if [ "$failure_code" -eq "$AUTH_LOCAL_STATE_PERMISSION_EXIT_CODE" ]; then
    auth_local_state_permission_failure
    return
  fi
  echo "❌ ${action} 未能在当前 Agent 执行环境取得可确认结果，已停止。"
  echo "📋 这通常表示当前执行环境缺少联网权限、CLI wrapper 混入输出，或 stdout/stderr 无法唯一解析。"
  echo "📋 这不代表支付宝业务失败，也不能据此判断用户本机 logout/login 失败。"
  echo "📋 Agent 应申请可联网权限后重试同一条 auth.sh 命令；不要要求用户手动 logout/login 代替本轮事实。"
  emit_control "AUTH_FLOW:RETRY_WITH_NETWORK"
}

handle_auth_cli_result() {
  local cli_result="$1" error_type
  error_type=$(detect_error "$cli_result")
  if handle_error "$cli_result"; then
    return 0
  fi
  case "$error_type" in
    MCP_AUTH_ERROR|AUTH_MISMATCH|CLI_LOCAL_FS_PERMISSION)
      # error_handler.sh already emitted the unique recovery marker.
      ;;
    MCP_SERVICE_ERROR|SERVICE_UNSTABLE)
      emit_control "AUTH_FLOW:RETRY_WITH_NETWORK"
      ;;
    *)
      emit_control "AUTH_FLOW:FAILED"
      ;;
  esac
  return 1
}

wait_for_effective_whoami() {
  local action="$1"
  local max_attempts=3
  local interval_seconds=2
  local attempt=1
  local logged_in is_expired

  AUTH_WHOAMI_RESULT=""
  if [ "${ALIPAY_AIPAY_TEST_MODE:-0}" = "1" ] && [[ "${AUTH_WHOAMI_RECHECK_INTERVAL_SECONDS:-}" =~ ^[0-9]+$ ]]; then
    interval_seconds="$AUTH_WHOAMI_RECHECK_INTERVAL_SECONDS"
  fi

  while [ "$attempt" -le "$max_attempts" ]; do
    AUTH_WHOAMI_RESULT=$(run_json_command "alipay-cli whoami --json" alipay-cli whoami --json) || {
      auth_cli_environment_failure "$action" "$?"
      return 1
    }
    handle_auth_cli_result "$AUTH_WHOAMI_RESULT" || return 1

    logged_in=$(echo "$AUTH_WHOAMI_RESULT" | jq -r '.data.logged_in // false')
    is_expired=$(echo "$AUTH_WHOAMI_RESULT" | jq -r '.data.is_expired // false')
    if [ "$logged_in" = "true" ] && [ "$is_expired" != "true" ]; then
      return 0
    fi

    emit_control "AUTH_WHOAMI_RECHECK=${attempt}/${max_attempts}"
    if [ "$attempt" -lt "$max_attempts" ]; then
      sleep "$interval_seconds"
    fi
    attempt=$((attempt + 1))
  done

  emit_control "AUTH_WHOAMI_NOT_EFFECTIVE"
  return 2
}

run_json_command() {
  local label="$1"
  shift
  local stderr_file stdout stderr_output combined_output exit_code json_payload

  stderr_file="$(mktemp "${TMPDIR:-/tmp}/alipay_auth_stderr.XXXXXX")" || return 1
  stdout=$(PLATFORM="${DEV_TOOL_NAME}" PLATFORM_ID="${PLATFORM_ID:-}" ALIPAYCLI_BIZ_INFO="$ALIPAYCLI_BIZ_INFO" PRODUCT="${PRODUCT:-}" "$@" 2>"$stderr_file")
  exit_code=$?
  stderr_output=$(cat "$stderr_file")

  combined_output=$(printf '%s\n%s' "$stdout" "$stderr_output")
  if auth_has_local_state_permission_error "$combined_output"; then
    rm -f "$stderr_file"
    return "$AUTH_LOCAL_STATE_PERMISSION_EXIT_CODE"
  fi
  if json_payload=$(extract_json_payload "$combined_output"); then
    rm -f "$stderr_file"
    printf '%s' "$json_payload"
    return 0
  fi

  echo "❌ ${label} 未返回可唯一解析的合法 JSON（退出码: ${exit_code}）；原始输出已隐藏，请申请联网权限后重试同一条 auth.sh 命令" >&2
  rm -f "$stderr_file"
  return 1
}

# 校验当前登录会话是否覆盖目标产品 scope 和 MCC。
# 可复用调用方已经取得的 whoami JSON，避免重复查询。
validate_current_authorization() {
  local whoami_result="${1:-}"
  local logged_in is_expired granted_scope required_scope
  local scope_match mcc_verify_result mcc_verify_unwrapped mcc_match mcc_raw retry_rc
  local mcc_error_type mcc_error_code mcc_success
  local mismatch_type sign_status_output sign_status_marker sign_flow_marker sign_reuse_receipt
  local granted_scope_item required_scope_item required_scope_found
  local -a granted_scope_items required_scope_items

  if [ -z "$SALES_CODE" ] || [ -z "$MCC_CODE" ]; then
    echo "❌ 缺少授权校验参数"
    emit_control "AUTH_FLOW:FAILED"
    return 1
  fi

  if [ -z "$whoami_result" ]; then
    whoami_result=$(run_json_command "alipay-cli whoami --json" alipay-cli whoami --json) || {
      auth_cli_environment_failure "登录状态复核" "$?"
      return 1
    }
  fi

  handle_auth_cli_result "$whoami_result" || return 1

  logged_in=$(echo "$whoami_result" | jq -r '.data.logged_in // false')
  is_expired=$(echo "$whoami_result" | jq -r '.data.is_expired // false')
  if [ "$logged_in" != "true" ] || [ "$is_expired" = "true" ]; then
    echo "❌ 当前登录状态无效或已过期"
    emit_control "AUTH_FLOW:FAILED"
    return 1
  fi

  granted_scope=$(echo "$whoami_result" | jq -r '.data.scope // empty')
  required_scope=$(get_scope "$SALES_CODE")
  if [ -z "$required_scope" ] || [ "$SCOPE" != "$required_scope" ]; then
    echo "❌ 当前产品的固定 scope 上下文无效"
    emit_control "AUTH_FLOW:FAILED"
    return 1
  fi

  scope_match="true"
  IFS=',' read -r -a granted_scope_items <<< "$granted_scope"
  IFS=',' read -r -a required_scope_items <<< "$required_scope"
  for required_scope_item in "${required_scope_items[@]}"; do
    required_scope_found="false"
    for granted_scope_item in "${granted_scope_items[@]}"; do
      granted_scope_item="${granted_scope_item#"${granted_scope_item%%[![:space:]]*}"}"
      granted_scope_item="${granted_scope_item%"${granted_scope_item##*[![:space:]]}"}"
      if [ "$granted_scope_item" = "$required_scope_item" ]; then
        required_scope_found="true"
        break
      fi
    done
    if [ "$required_scope_found" != "true" ]; then
      scope_match="false"
      break
    fi
  done

  mcc_match="true"
  if [ "$scope_match" = "true" ]; then
    export PLATFORM="${DEV_TOOL_NAME}" PLATFORM_ID="${PLATFORM_ID:-}"
    ALIPAY_AIPAY_SUPPRESS_LOCAL_FS_RETRY_MARKER=1 run_network_retry mcc_raw read authorization_mcc_check -- alipay-cli mcp call ar-query.queryArInfosBySalesProd \
      -d "{\"request\":{\"salesProductCodes\":[\"${SALES_CODE}\"]},\"ctx\":{}}" \
      --json
    retry_rc=$?
    if [ "$retry_rc" -eq "$AUTH_LOCAL_STATE_PERMISSION_EXIT_CODE" ]; then
      auth_local_state_permission_failure
      return 1
    fi
    if [ "$retry_rc" -ne 0 ]; then
      echo "❌ 授权 MCC 校验因网络或服务异常在自动重试两次后仍未恢复"
      emit_control "AUTH_FLOW:RETRY_WITH_NETWORK"
      return 1
    fi
    mcc_verify_result=$(extract_json_payload "$mcc_raw") || {
      echo "❌ alipay-cli mcp call ar-query.queryArInfosBySalesProd 未返回合法 JSON"
      emit_control "AUTH_FLOW:RETRY_WITH_NETWORK"
      return 1
    }

    mcc_verify_unwrapped=$(unwrap_mcp "$mcc_verify_result")
    mcc_error_type=$(detect_error "$mcc_verify_result" "MCP_AUTHENTICATED_CALL")
    if [ "$mcc_error_type" = "AUTH_MISMATCH" ]; then
      mcc_match="false"
    elif [ "$mcc_error_type" = "MCP_AUTH_ERROR" ]; then
      handle_error "$mcc_verify_result" "MCP_AUTHENTICATED_CALL" || true
      return 1
    elif [ "$mcc_error_type" != "SUCCESS" ]; then
      echo "❌ MCC 校验失败"
      emit_control "AUTH_FLOW:FAILED"
      return 1
    fi

    # 保留对非标准错误响应的兼容，只在后端明确返回 MCC 未授权时判定不匹配。
    mcc_error_code=$(echo "$mcc_verify_unwrapped" | jq -r '.errorCode // .data.errorCode // ""' 2>/dev/null)
    mcc_success=$(echo "$mcc_verify_unwrapped" | jq -r '.success // "null"' 2>/dev/null)
    if [ "$mcc_success" = "false" ] && [ -n "$mcc_error_code" ] && \
       echo "$mcc_verify_unwrapped" | jq -r '.errorMessage // .data.errorMessage // .error.message // ""' 2>/dev/null | grep -qi "mccCode.*is not auth"; then
      mcc_match="false"
    elif echo "$mcc_verify_unwrapped" | grep -qi "mccCode.*is not auth"; then
      mcc_match="false"
    fi

    # 同一请求也是 Step 3.1 的签约查询；仅在完整结构可由共享解析器证明时输出可复用事实。
    if [ "$mcc_match" = "true" ] && sign_status_output=$(emit_sign_status_from_business "$mcc_verify_unwrapped" "$SALES_CODE" 2>/dev/null); then
      printf '%s\n' "$sign_status_output" \
        | while IFS= read -r marker; do emit_control "$marker"; done
      sign_status_marker=$(printf '%s\n' "$sign_status_output" | awk -F= '/^SIGN_STATUS=/{print $2; exit}')
      sign_flow_marker=$(printf '%s\n' "$sign_status_output" | awk '/^FLOW:/{print; exit}')
      if [ -n "$sign_status_marker" ] && [ -n "$sign_flow_marker" ] && sign_reuse_receipt=$(create_auth_sign_reuse_receipt "$sign_status_marker" "$sign_flow_marker"); then
        emit_control "AUTH_SIGN_REUSE_RECEIPT=${sign_reuse_receipt}"
      fi
      emit_control "AUTH_SIGN_QUERY_REUSABLE=true"
    fi
  fi

  if [ "$scope_match" = "true" ] && [ "$mcc_match" = "true" ]; then
    emit_control "✅ 授权范围校验通过（scope + MCC 授权有效性）"
    return 0
  fi

  if [ "$scope_match" != "true" ]; then
    mismatch_type="SCOPE_MISMATCH"
  else
    mismatch_type="MCC_MISMATCH"
  fi
  emit_control "AUTH_FLOW:${mismatch_type}"
  return 1
}

# ─── auth init: 检查登录状态 + 执行登录 + 构建授权链接 + 输出授权信息 ────────
auth_init() {
  local DEFER_OPEN=false
  SCOPE=""
  SALES_CODE=""
  MCC_CODE=""
  PRODUCT_NAME=""
  MCC_NAME=""
  MCC_CONTEXT_RECEIPT=""

  while [[ $# -gt 0 ]]; do
    case $1 in
      --defer-open)
        DEFER_OPEN=true; shift ;;
      --scope)
        [ $# -ge 2 ] || { echo "❌ 缺少参数值: $1"; exit 1; }
        SCOPE="$2"; shift 2 ;;
      --sales-code)
        [ $# -ge 2 ] || { echo "❌ 缺少参数值: $1"; exit 1; }
        SALES_CODE="$2"; shift 2 ;;
      --mcc-code)
        [ $# -ge 2 ] || { echo "❌ 缺少参数值: $1"; exit 1; }
        MCC_CODE="$2"; shift 2 ;;
      --product-name)
        [ $# -ge 2 ] || { echo "❌ 缺少参数值: $1"; exit 1; }
        PRODUCT_NAME="$2"; shift 2 ;;
      --mcc-name)
        [ $# -ge 2 ] || { echo "❌ 缺少参数值: $1"; exit 1; }
        MCC_NAME="$2"; shift 2 ;;
      --mcc-context-receipt)
        [ $# -ge 2 ] || { echo "❌ 缺少参数值: $1"; exit 1; }
        MCC_CONTEXT_RECEIPT="$2"; shift 2 ;;
      *) echo "❌ 未知参数: $1"; exit 1 ;;
    esac
  done

  if [ -z "$SCOPE" ] || [ -z "$SALES_CODE" ] || [ -z "$MCC_CODE" ] || [ -z "$PRODUCT_NAME" ] || [ -z "$MCC_NAME" ] || [ -z "$MCC_CONTEXT_RECEIPT" ]; then
    echo "❌ 缺少必填参数"
    echo "用法: bash auth.sh init --defer-open --scope <scope> --sales-code <code> --mcc-code <code> --product-name <name> --mcc-name <name> --mcc-context-receipt <receipt>"
    exit 1
  fi
  if [ "$DEFER_OPEN" != true ]; then
    echo "❌ 参数格式错误：auth init 必须使用 --defer-open，确保先展示授权说明和链接，再自动打开页面"
    echo "用法: bash auth.sh init --defer-open --scope <scope> --sales-code <code> --mcc-code <code> --product-name <name> --mcc-name <name> --mcc-context-receipt <receipt>"
    exit 1
  fi
  validate_auth_context || return 1
  # 新 init 表示按已确认上下文重建授权链路；只在机器校验通过后替换旧短时状态。
  reset_auth_state_for_init || return 1

  # Step 1: 检查登录状态
  CHECK_RESULT=$(run_json_command "alipay-cli whoami --json" alipay-cli whoami --json) || {
    auth_cli_environment_failure "登录状态检查" "$?"
    return 1
  }
  handle_auth_cli_result "$CHECK_RESULT" || return 1
  LOGGED_IN=$(echo "$CHECK_RESULT" | jq -r '.data.logged_in // false')
  IS_EXPIRED=$(echo "$CHECK_RESULT" | jq -r '.data.is_expired // false')

  if [ "$LOGGED_IN" = "true" ] && [ "$IS_EXPIRED" = "false" ]; then
    if [ -n "$AUTH_INIT_CONTEXT_MISMATCH_TYPE" ]; then
      # 后端查询没有权威 MCC 字段，旧状态变化时不能把现有登录误判为当前上下文已授权。
      DEVICE_CODE=""
      BROWSER_URL=""
      if ! save_auth_state; then
        emit_control "AUTH_STATE:SAVE_FAILED"
      fi
      emit_control "AUTH_FLOW:${AUTH_INIT_CONTEXT_MISMATCH_TYPE}"
      return 1
    fi
    validate_current_authorization "$CHECK_RESULT" || return 1
    DEVICE_CODE=""
    if ! save_auth_state; then
      emit_control "AUTH_STATE:SAVE_FAILED"
    fi
    emit_stage_metric "onboarding.login"
    emit_control "✅ 当前登录及授权范围有效，可继续后续流程"
    emit_control "AUTH_FLOW:SKIP"
    return 0
  fi

  # Step 2: 执行登录
  auth_require_local_state_access || return 1
  LOGIN_RESULT=$(run_json_command "alipay-cli login --non-interactive --scope" alipay-cli login --non-interactive --scope "$SCOPE" --json) || {
    auth_cli_environment_failure "授权登录发起" "$?"
    return 1
  }
  handle_auth_cli_result "$LOGIN_RESULT" || return 1
  LOGIN_STATUS=$(echo "$LOGIN_RESULT" | jq -r '.data.status // ""')

  if [ "$LOGIN_STATUS" = "already_logged_in" ]; then
    validate_current_authorization || return 1
    DEVICE_CODE=""
    if ! save_auth_state; then
      emit_control "AUTH_STATE:SAVE_FAILED"
    fi
    emit_stage_metric "onboarding.login"
    emit_control "✅ 当前登录及授权范围有效，可继续后续流程"
    emit_control "AUTH_FLOW:SKIP"
    return 0
  fi

  # Step 3: 解析返回结果
  # alipay-cli login 返回结构为 .data.device_code（不是 .data.data.device_code）
  DEVICE_CODE=$(echo "$LOGIN_RESULT" | jq -r '.data.device_code // empty')
  VERIFICATION_CODE=$(echo "$LOGIN_RESULT" | jq -r '.data.verification_code // empty')
  EXPIRES_IN=$(echo "$LOGIN_RESULT" | jq -r '.data.expires_in // 600')

  # Step 4: 参数校验
  if [ -z "$DEVICE_CODE" ] || [ -z "$SALES_CODE" ] || [ -z "$MCC_CODE" ]; then
    echo "❌ 授权链接参数不完整，无法生成授权链接"
    [ -n "$DEVICE_CODE" ] || echo "📋 缺少字段: deviceCode"
    [ -n "$SALES_CODE" ] || echo "📋 缺少字段: productCode"
    [ -n "$MCC_CODE" ] || echo "📋 缺少字段: mccCode"
    exit 1
  fi

  # Step 5: 由统一校验器编码、构建并逐字段校验授权链接。
  BROWSER_URL=$(build_authorization_url) || {
    echo "❌ 授权链接构建失败，缺少必要参数或误用了 CLI verification_url，已停止。"
    echo "📋 正确格式: https://aipay.alipay.com/cli-auth?deviceCode=...&productCode=...&mccCode=..."
    return 1
  }

  # Step 6: 有效期转换（对非数字做防护）
  if [[ "$EXPIRES_IN" =~ ^[0-9]+$ ]] && [ "$EXPIRES_IN" -ge 60 ]; then
    EXPIRES_MIN=$((EXPIRES_IN / 60))
    EXPIRES_DISPLAY="${EXPIRES_MIN} 分钟"
  elif [[ "$EXPIRES_IN" =~ ^[0-9]+$ ]]; then
    EXPIRES_DISPLAY="${EXPIRES_IN} 秒"
  else
    EXPIRES_DISPLAY="10 分钟"
  fi

  # Step 7: 由统一目录渲染授权信息；独立 open 动作在消息发出后打开。
  DISPLAY_CODE="${VERIFICATION_CODE:-（请查看支付宝授权页面）}"
  MESSAGE_INPUT=$(printf '%s\n' "$PRODUCT_NAME" "$DEVICE_CODE" "$MCC_CODE" "$MCC_NAME" "$MCC_CONTEXT_RECEIPT" "$DISPLAY_CODE" "$EXPIRES_DISPLAY" "$BROWSER_URL" | jq -Rs '
    split("\n") as $v | {productName:$v[0],deviceCode:$v[1],mccCode:$v[2],mccName:$v[3],mccContextReceipt:$v[4],verificationCode:$v[5],expiresDisplay:$v[6],officialUrl:$v[7]}
  ')
  if ! printf '%s' "$MESSAGE_INPUT" | ALIPAY_AIPAY_RENDERER_MANAGED_CALLER=auth.sh node "$RENDERER" auth.page --variant READY; then
    cleanup_auth_state
    emit_control "AUTH_FLOW:FAILED"
    exit 1
  fi
  # Step 8: 页面 stdout 已经安全送达时，状态文件只用于 opener 便利；保存失败不得生成第二个授权页或截断 wait。
  save_auth_state_after_page_delivery
  echo ""
  emit_control "AUTH_FLOW:READY_TO_OPEN"
}

render_auth_open_manual() {
  printf '%s' '{}' | ALIPAY_AIPAY_RENDERER_MANAGED_CALLER=auth.sh node "$RENDERER" auth.open.manual --variant DEFAULT
}

auth_manual_open() {
  if [ "$#" -ne 0 ]; then
    echo "用法: bash auth.sh manual-open"
    return 1
  fi
  render_auth_open_manual || { emit_control "AUTH_FLOW:FAILED"; return 1; }
}

auth_open() {
  local saved_device saved_url validate_input open_status open_helper

  restore_auth_context_or_state "$@" || exit 1
  saved_device=$(jq -r '.deviceCode // ""' "$AUTH_STATE_FILE" 2>/dev/null || printf '')
  saved_url=$(jq -r '.authorizationUrl // ""' "$AUTH_STATE_FILE" 2>/dev/null || printf '')
  if [ -z "$saved_device" ] || [ -z "$saved_url" ]; then
    emit_control "AUTH_OPEN:LINK_ONLY"
    return 0
  fi

  validate_input=$(jq -n \
    --arg productName "$PRODUCT_NAME" \
    --arg salesCode "$SALES_CODE" \
    --arg scope "$SCOPE" \
    --arg mccCode "$MCC_CODE" \
    --arg mccName "$MCC_NAME" \
    --arg mccContextReceipt "${MCC_CONTEXT_RECEIPT:-}" \
    --arg deviceCode "$saved_device" \
    --arg officialUrl "$saved_url" \
    '{productName:$productName,salesCode:$salesCode,scope:$scope,mccCode:$mccCode,mccName:$mccName,mccContextReceipt:$mccContextReceipt,deviceCode:$deviceCode,officialUrl:$officialUrl}') || return 1
  if ! printf '%s' "$validate_input" | node "$RENDERER" --validate-authorization-context >/dev/null; then
    echo "❌ 授权页面上下文校验失败，已停止打开"
    emit_control "AUTH_FLOW:FAILED"
    return 1
  fi

  open_helper="${SCRIPT_DIR}/../../../normal/scripts/open_official_url.sh"
  open_status=$(printf '%s\n' "$saved_url" | bash "$open_helper" authorization)
  case "$open_status" in OPENED|OPEN_FAILED|GUI_UNAVAILABLE|LINK_ONLY) ;; *) open_status="OPEN_FAILED" ;; esac
  emit_control "AUTH_OPEN:${open_status}"
}

# ─── auth confirm: 授权确认 + scope 校验 + MCC 授权有效性校验 ────────────────
auth_confirm() {
  AUTH_CONFIRM_RESULT=""
  # 优先使用显式传入的非敏感上下文；未传时再从状态文件兜底恢复。
  restore_auth_context_or_state "$@" || exit 1

  if [ -z "$SALES_CODE" ]; then
    echo "❌ 缺少 SALES_CODE（请传入 --sales-code，或先执行 auth.sh init）"
    exit 1
  fi
  if [ -z "$MCC_CODE" ]; then
    echo "❌ 缺少 MCC_CODE（请传入 --mcc-code，或先执行 auth.sh init）"
    exit 1
  fi

  # Step 1: 执行授权确认
  auth_require_local_state_access || return 1
  LOGIN_COMPLETE_RESULT=$(run_json_command "alipay-cli login --complete --json" alipay-cli login --complete --json) || {
    auth_cli_environment_failure "授权完成确认" "$?"
    return 1
  }

  # Step 2: 判断授权结果
  # alipay-cli login --complete: success=true/logged_in 表示可进入 whoami 门禁；
  # authorization_pending/auth_expired 可能出现在 .error.code、.data.error.code 或 status 中。
  OUTER_SUCCESS=$(echo "$LOGIN_COMPLETE_RESULT" | jq -r '.success // false')
  DATA_STATUS=$(echo "$LOGIN_COMPLETE_RESULT" | jq -r '.data.status // ""')
  ERROR_CODE=$(echo "$LOGIN_COMPLETE_RESULT" | jq -r '.error.code // .data.error.code // ""')

  if [ "$ERROR_CODE" = "authorization_pending" ] || [ "$DATA_STATUS" = "authorization_pending" ] || [ "$DATA_STATUS" = "pending" ]; then
    AUTH_CONFIRM_RESULT="PENDING"
    if [ "${AUTH_POLLING:-false}" != "true" ]; then
      if ! printf '%s' '{}' | ALIPAY_AIPAY_RENDERER_MANAGED_CALLER=auth.sh node "$RENDERER" auth.pending --variant DEFAULT; then
        emit_control "AUTH_FLOW:FAILED"
        return 1
      fi
      emit_control "AUTH_FLOW:PENDING"
    fi
    return 0
  elif [ "$ERROR_CODE" = "auth_expired" ] || [ "$DATA_STATUS" = "auth_expired" ] || [ "$DATA_STATUS" = "expired" ]; then
    AUTH_CONFIRM_RESULT="EXPIRED"
    cleanup_auth_state
    if ! printf '%s' '{}' | ALIPAY_AIPAY_RENDERER_MANAGED_CALLER=auth.sh node "$RENDERER" auth.expired --variant DEFAULT; then
      emit_control "AUTH_FLOW:FAILED"
      return 1
    fi
    emit_control "AUTH_FLOW:EXPIRED"
    return 0
  elif [ "$OUTER_SUCCESS" = "true" ] || [ "$DATA_STATUS" = "logged_in" ] || [ "$DATA_STATUS" = "already_logged_in" ] || [ "$DATA_STATUS" = "completed" ]; then
    :
  else
    if ! handle_auth_cli_result "$LOGIN_COMPLETE_RESULT"; then
      cleanup_auth_state
      return 1
    fi
    wait_for_effective_whoami "授权完成确认状态复核"
    whoami_rc=$?
    if [ "$whoami_rc" -eq 2 ]; then
      AUTH_CONFIRM_RESULT="PENDING"
      if [ "${AUTH_POLLING:-false}" != "true" ]; then
        if ! printf '%s' '{}' | ALIPAY_AIPAY_RENDERER_MANAGED_CALLER=auth.sh node "$RENDERER" auth.pending --variant DEFAULT; then
          emit_control "AUTH_FLOW:FAILED"
          return 1
        fi
        emit_control "AUTH_FLOW:PENDING"
      fi
      return 0
    elif [ "$whoami_rc" -ne 0 ]; then
      return 1
    fi
    validate_current_authorization "$AUTH_WHOAMI_RESULT" || return 1
    cleanup_auth_state
    AUTH_CONFIRM_RESULT="AUTH_SUCCESS"
    emit_stage_metric "onboarding.login"
    emit_control "✅ 授权确认成功（本机 CLI 登录态、scope 与 MCC 授权有效性均已通过）"
    emit_control "AUTH_FLOW:AUTH_SUCCESS"
    return 0
  fi

  # Step 3: 复用 init 的 scope + MCC 授权有效性校验
  wait_for_effective_whoami "授权后登录状态复核"
  whoami_rc=$?
  if [ "$whoami_rc" -eq 2 ]; then
    AUTH_CONFIRM_RESULT="PENDING"
    if [ "${AUTH_POLLING:-false}" != "true" ]; then
      if ! printf '%s' '{}' | ALIPAY_AIPAY_RENDERER_MANAGED_CALLER=auth.sh node "$RENDERER" auth.pending --variant DEFAULT; then
        emit_control "AUTH_FLOW:FAILED"
        return 1
      fi
      emit_control "AUTH_FLOW:PENDING"
    fi
    return 0
  elif [ "$whoami_rc" -ne 0 ]; then
    return 1
  fi
  validate_current_authorization "$AUTH_WHOAMI_RESULT" || return 1
  cleanup_auth_state
  AUTH_CONFIRM_RESULT="AUTH_SUCCESS"
  emit_stage_metric "onboarding.login"
  emit_control "✅ 授权确认成功（本机 CLI 登录态、scope 与 MCC 授权有效性均已通过）"
  emit_control "AUTH_FLOW:AUTH_SUCCESS"
  return 0
}

# ─── auth wait: 授权页打开后有限轮询确认状态 ────────────────────────────────
auth_wait() {
  local attempt=1
  local max_attempts=12
  local interval_seconds=5

  if [ "${ALIPAY_AIPAY_TEST_MODE:-0}" = "1" ] && [[ "${AUTH_CONFIRM_POLL_INTERVAL_SECONDS:-}" =~ ^[0-9]+$ ]]; then
    interval_seconds="$AUTH_CONFIRM_POLL_INTERVAL_SECONDS"
  fi

  while [ "$attempt" -le "$max_attempts" ]; do
    AUTH_POLLING=true
    if ! auth_confirm "$@"; then
      AUTH_POLLING=false
      return 1
    fi
    AUTH_POLLING=false

    case "$AUTH_CONFIRM_RESULT" in
      AUTH_SUCCESS|EXPIRED)
        return 0
        ;;
      PENDING)
        emit_control "AUTH_POLL_PENDING=${attempt}/${max_attempts}"
        if [ "$attempt" -eq "$max_attempts" ]; then
          if ! printf '%s' '{}' | ALIPAY_AIPAY_RENDERER_MANAGED_CALLER=auth.sh node "$RENDERER" auth.pending --variant DEFAULT; then
            emit_control "AUTH_FLOW:FAILED"
            return 1
          fi
          emit_control "AUTH_FLOW:PENDING"
          return 0
        fi
        sleep "$interval_seconds"
        ;;
      *)
        emit_control "AUTH_FLOW:FAILED"
        return 1
        ;;
    esac
    attempt=$((attempt + 1))
  done
}

# ─── auth mismatch: 授权范围不满足 → logout → 重新授权 ──────────────────────
auth_mismatch() {
  local mismatch_message=""
  if [ "${1:-}" = "--defer-open" ]; then
    shift
  else
    echo "❌ 参数格式错误：auth mismatch 必须使用 --defer-open，确保重新授权时先展示说明和链接，再自动打开页面"
    echo "用法: bash auth.sh mismatch --defer-open [--scope <scope> --sales-code <code> --mcc-code <code> --product-name <name> --mcc-name <name> --mcc-context-receipt <receipt>]"
    return 1
  fi

  # 优先使用显式传入的非敏感上下文；未传时再从状态文件兜底恢复。
  restore_auth_context_or_state "$@" || exit 1

  if [ -z "$SALES_CODE" ]; then
    echo "❌ 缺少 SALES_CODE（请传入 --sales-code，或先执行 auth.sh init）"
    return 1
  fi

  # Step 1: 根据 salesCode 构造正确的 scope；目标无效时不退出当前登录。
  SCOPE=$(get_scope "$SALES_CODE")
  if [ -z "$SCOPE" ]; then
    echo "❌ 未知产品码: $SALES_CODE"
    return 1
  fi

  # Step 2: mismatch 是授权不匹配恢复路径中唯一执行 logout 的入口。
  auth_require_local_state_access || return 1
  if ! mismatch_message=$(printf '%s' '{}' | ALIPAY_AIPAY_RENDERER_MANAGED_CALLER=auth.sh node "$RENDERER" auth.mismatch --variant DEFAULT); then
    emit_control "AUTH_FLOW:FAILED"
    return 1
  fi
  confirm_logout_postcondition
  case "$ALIPAY_LOGOUT_POSTCONDITION" in
    COMMAND_CONFIRMED_SUCCESS|POSTCONDITION_LOGGED_OUT)
      ;;
    STILL_LOGGED_IN)
      render_logout_still_logged_in || return 1
      emit_control "AUTH_FLOW:LOGOUT_STILL_LOGGED_IN"
      return 1
      ;;
    LOCAL_FS_PERMISSION)
      auth_local_state_permission_failure
      return 1
      ;;
    *)
      render_logout_unconfirmed || return 1
      emit_control "AUTH_FLOW:RETRY_WITH_NETWORK"
      return 1
      ;;
  esac
  printf '%s\n' "$mismatch_message"

  # Step 3: 调用 auth init 执行登录 + 构建授权链接 + 输出唯一授权消息。
  # DEV_TOOL_NAME 已 export，子进程可继承。
  auth_init \
    --defer-open \
    --scope "$SCOPE" \
    --sales-code "$SALES_CODE" \
    --mcc-code "$MCC_CODE" \
    --product-name "${PRODUCT_NAME:-}" \
    --mcc-name "${MCC_NAME:-}" \
    --mcc-context-receipt "${MCC_CONTEXT_RECEIPT:-}"
}

# ─── 入口分发 ────────────────────────────────────────────────────────────────
case "${1:-}" in
  init)
    shift
    auth_init "$@"
    ;;
  confirm)
    shift
    auth_confirm "$@"
    ;;
  open)
    shift
    auth_open "$@"
    ;;
  manual-open)
    shift
    auth_manual_open "$@"
    ;;
  wait)
    shift
    auth_wait "$@"
    ;;
  mismatch)
    shift
    auth_mismatch "$@"
    ;;
  *)
    echo "用法: bash auth.sh <init|open|manual-open|wait|confirm|mismatch> [参数...]"
    echo ""
    echo "  auth init    --defer-open --scope <scope> --sales-code <code> --mcc-code <code> --product-name <name> --mcc-name <name> --mcc-context-receipt <receipt>"
    echo "  auth open    [--scope <scope> --sales-code <code> --mcc-code <code> --product-name <name> --mcc-name <name> --mcc-context-receipt <receipt>]"
    echo "  auth manual-open  - 输出手动访问提示"
    echo "  auth wait    [--scope <scope> --sales-code <code> --mcc-code <code> --product-name <name> --mcc-name <name> --mcc-context-receipt <receipt>]"
    echo "  auth confirm [--scope <scope> --sales-code <code> --mcc-code <code> --product-name <name> --mcc-name <name> --mcc-context-receipt <receipt>]"
    echo "  auth mismatch --defer-open [--scope <scope> --sales-code <code> --mcc-code <code> --product-name <name> --mcc-name <name> --mcc-context-receipt <receipt>]"
    exit 1
    ;;
esac
