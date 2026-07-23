#!/bin/bash
#=============================================================================
# 脚本名称: auth.sh
# 功能描述: 登录授权全流程 - 检查状态 + 执行登录 + 授权确认 + scope/MCC 校验 + 重新授权
# 调用位置: Step 3 登录授权
# 调用前置: 脚本通过 error_handler.sh 间接初始化 DEV_TOOL_NAME；必要时可用 DEV_TOOL_NAME 环境变量覆盖
# 用法:
#   auth init   --scope <scope> --sales-code <code> --mcc-code <code> --product-name <name> --mcc-name <name>
#   auth confirm [--scope <scope> --sales-code <code> --mcc-code <code> --product-name <name> --mcc-name <name>]
#   auth mismatch [--scope <scope> --sales-code <code> --mcc-code <code> --product-name <name> --mcc-name <name>]
# 返回值:
#   init:     AUTH_FLOW:SKIP | AUTH_FLOW:READY | AUTH_FLOW:SCOPE_MISMATCH | AUTH_FLOW:MCC_MISMATCH | AUTH_FLOW:RETRY_WITH_NETWORK | AUTH_FLOW:FAILED
#   confirm:  AUTH_FLOW:AUTH_SUCCESS | AUTH_FLOW:PENDING | AUTH_FLOW:EXPIRED | AUTH_FLOW:SCOPE_MISMATCH | AUTH_FLOW:MCC_MISMATCH | AUTH_FLOW:RETRY_WITH_NETWORK | AUTH_FLOW:FAILED
#   mismatch: logout 可确认成功后调用 auth init 重新生成授权链接；无法确认 CLI 结果时输出 AUTH_FLOW:RETRY_WITH_NETWORK
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
RENDERER="${SCRIPT_DIR}/../../../normal/scripts/render_customer_message.mjs"

require_command jq || exit 1
require_command alipay-cli || exit 1
require_command node || exit 1
require_command mktemp || exit 1
umask 077

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
    --arg deviceCode "${DEVICE_CODE:-}" \
    '{
      salesCode: $salesCode,
      mccCode: $mccCode,
      scope: $scope,
      productName: $productName,
      mccName: $mccName,
      deviceCode: $deviceCode
    }' > "$temp_state" || { rm -f "$temp_state"; return 1; }
  mv "$temp_state" "$AUTH_STATE_FILE" || { rm -f "$temp_state"; return 1; }
  validate_auth_state_file || {
    cleanup_auth_state
    echo "❌ 无法确认授权状态文件权限为 0600，已停止" >&2
    return 1
  }
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
  for field in salesCode mccCode scope productName mccName; do
    case "$field" in
      salesCode) current="$SALES_CODE" ;;
      mccCode) current="$MCC_CODE" ;;
      scope) current="$SCOPE" ;;
      productName) current="$PRODUCT_NAME" ;;
      mccName) current="$MCC_NAME" ;;
    esac
    saved=$(jq -r --arg field "$field" '.[$field] // ""' "$AUTH_STATE_FILE")
    if [ -n "$current" ] && [ -n "$saved" ] && [ "$current" != "$saved" ]; then
      echo "❌ 当前授权参数与 auth.sh init 保存的本次授权上下文不一致，已停止"
      echo "AUTH_FLOW:FAILED"
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
    '{productName:$productName,salesCode:$salesCode,scope:$scope,mccCode:$mccCode,mccName:$mccName}') || return 1
  if ! printf '%s' "$context_json" | node "$RENDERER" --validate-authorization-context >/dev/null; then
    echo "❌ 授权上下文校验失败：产品、产品码、scope 或 MCC 不匹配当前固定规则"
    echo "AUTH_FLOW:FAILED"
    return 1
  fi
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
    '{productName:$productName,salesCode:$salesCode,scope:$scope,mccCode:$mccCode,mccName:$mccName,deviceCode:$deviceCode,platform:$platform}') || return 1
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

auth_cli_environment_failure() {
  local action="$1"
  echo "❌ ${action} 未能在当前 Agent 执行环境取得可确认结果，已停止。"
  echo "📋 这通常表示当前执行环境缺少联网权限、CLI wrapper 混入输出，或 stdout/stderr 无法唯一解析。"
  echo "📋 这不代表支付宝业务失败，也不能据此判断用户本机 logout/login 失败。"
  echo "📋 Agent 应申请可联网权限后重试同一条 auth.sh 命令；不要要求用户手动 logout/login 代替本轮事实。"
  echo "AUTH_FLOW:RETRY_WITH_NETWORK"
}

run_json_command() {
  local label="$1"
  shift
  local stderr_file stdout stderr_output combined_output exit_code json_payload

  stderr_file="$(mktemp "${TMPDIR:-/tmp}/alipay_auth_stderr.XXXXXX")" || return 1
  stdout=$(PLATFORM="${DEV_TOOL_NAME}" "$@" 2>"$stderr_file")
  exit_code=$?
  stderr_output=$(cat "$stderr_file")

  if json_payload=$(extract_json_payload "$stdout"); then
    rm -f "$stderr_file"
    printf '%s' "$json_payload"
    return 0
  fi

  if json_payload=$(extract_json_payload "$stderr_output"); then
    rm -f "$stderr_file"
    printf '%s' "$json_payload"
    return 0
  fi

  combined_output=$(printf '%s\n%s' "$stdout" "$stderr_output")
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
  local mismatch_type mismatch_message_input
  local granted_scope_item required_scope_item required_scope_found
  local -a granted_scope_items required_scope_items

  if [ -z "$SALES_CODE" ] || [ -z "$MCC_CODE" ]; then
    echo "❌ 缺少授权校验参数"
    echo "AUTH_FLOW:FAILED"
    return 1
  fi

  if [ -z "$whoami_result" ]; then
    whoami_result=$(run_json_command "alipay-cli whoami --json" alipay-cli whoami --json) || {
      auth_cli_environment_failure "登录状态复核"
      return 1
    }
  fi

  if ! handle_error "$whoami_result"; then
    echo "AUTH_FLOW:FAILED"
    return 1
  fi

  logged_in=$(echo "$whoami_result" | jq -r '.data.logged_in // false')
  is_expired=$(echo "$whoami_result" | jq -r '.data.is_expired // false')
  if [ "$logged_in" != "true" ] || [ "$is_expired" = "true" ]; then
    echo "❌ 当前登录状态无效或已过期"
    echo "AUTH_FLOW:FAILED"
    return 1
  fi

  granted_scope=$(echo "$whoami_result" | jq -r '.data.scope // empty')
  required_scope=$(get_scope "$SALES_CODE")
  if [ -z "$required_scope" ] || [ "$SCOPE" != "$required_scope" ]; then
    echo "❌ 当前产品的固定 scope 上下文无效"
    echo "AUTH_FLOW:FAILED"
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
    export PLATFORM=${DEV_TOOL_NAME}
    run_network_retry mcc_raw read authorization_mcc_check -- alipay-cli mcp call ar-query.queryArInfosBySalesProd \
      -d "{\"request\":{\"salesProductCodes\":[\"${SALES_CODE}\"]},\"ctx\":{}}" \
      --json
    retry_rc=$?
    if [ "$retry_rc" -ne 0 ]; then
      echo "❌ 授权 MCC 校验因网络或服务异常在自动重试两次后仍未恢复"
      echo "AUTH_FLOW:FAILED"
      return 1
    fi
    mcc_verify_result=$(extract_json_payload "$mcc_raw") || {
      echo "❌ alipay-cli mcp call ar-query.queryArInfosBySalesProd 未返回合法 JSON"
      echo "AUTH_FLOW:FAILED"
      return 1
    }

    mcc_verify_unwrapped=$(unwrap_mcp "$mcc_verify_result")
    mcc_error_type=$(detect_error "$mcc_verify_result")
    if [ "$mcc_error_type" = "AUTH_MISMATCH" ]; then
      mcc_match="false"
    elif [ "$mcc_error_type" != "SUCCESS" ]; then
      echo "❌ MCC 校验失败"
      echo "AUTH_FLOW:FAILED"
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
  fi

  if [ "$scope_match" = "true" ] && [ "$mcc_match" = "true" ]; then
    echo "✅ 授权范围校验通过（scope + MCC 授权有效性）"
    return 0
  fi

  if [ "$scope_match" != "true" ]; then
    mismatch_type="SCOPE_MISMATCH"
  else
    mismatch_type="MCC_MISMATCH"
  fi
  mismatch_message_input=$(jq -cn --arg mismatchType "$mismatch_type" '{mismatchType:$mismatchType}') || {
    echo "AUTH_FLOW:FAILED"
    return 1
  }
  if ! printf '%s' "$mismatch_message_input" | ALIPAY_AIPAY_RENDERER_MANAGED_CALLER=auth.sh node "$RENDERER" auth.mismatch --variant DEFAULT; then
    echo "AUTH_FLOW:FAILED"
    return 1
  fi
  echo "AUTH_FLOW:${mismatch_type}"
  return 1
}

# ─── auth init: 检查登录状态 + 执行登录 + 构建授权链接 + 输出授权信息 ────────
auth_init() {
  SCOPE=""
  SALES_CODE=""
  MCC_CODE=""
  PRODUCT_NAME=""
  MCC_NAME=""

  while [[ $# -gt 0 ]]; do
    case $1 in
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
      *) echo "❌ 未知参数: $1"; exit 1 ;;
    esac
  done

  if [ -z "$SCOPE" ] || [ -z "$SALES_CODE" ] || [ -z "$MCC_CODE" ] || [ -z "$PRODUCT_NAME" ] || [ -z "$MCC_NAME" ]; then
    echo "❌ 缺少必填参数"
    echo "用法: bash auth.sh init --scope <scope> --sales-code <code> --mcc-code <code> --product-name <name> --mcc-name <name>"
    exit 1
  fi
  validate_auth_context || return 1

  # Step 1: 检查登录状态
  CHECK_RESULT=$(run_json_command "alipay-cli whoami --json" alipay-cli whoami --json) || {
    auth_cli_environment_failure "登录状态检查"
    return 1
  }
  if ! handle_error "$CHECK_RESULT"; then
    echo "AUTH_FLOW:FAILED"
    return 1
  fi
  LOGGED_IN=$(echo "$CHECK_RESULT" | jq -r '.data.logged_in // false')
  IS_EXPIRED=$(echo "$CHECK_RESULT" | jq -r '.data.is_expired // false')

  if [ "$LOGGED_IN" = "true" ] && [ "$IS_EXPIRED" = "false" ]; then
    validate_current_authorization "$CHECK_RESULT" || return 1
    DEVICE_CODE=""
    save_auth_state || return 1
    echo "✅ 当前登录及授权范围有效，可继续后续流程"
    echo "AUTH_FLOW:SKIP"
    return 0
  fi

  # Step 2: 执行登录
  LOGIN_RESULT=$(run_json_command "alipay-cli login --non-interactive --scope" alipay-cli login --non-interactive --scope "$SCOPE" --json) || {
    auth_cli_environment_failure "授权登录发起"
    return 1
  }
  if ! handle_error "$LOGIN_RESULT"; then
    echo "AUTH_FLOW:FAILED"
    return 1
  fi
  LOGIN_STATUS=$(echo "$LOGIN_RESULT" | jq -r '.data.status // ""')

  if [ "$LOGIN_STATUS" = "already_logged_in" ]; then
    validate_current_authorization || return 1
    DEVICE_CODE=""
    save_auth_state || return 1
    echo "✅ 当前登录及授权范围有效，可继续后续流程"
    echo "AUTH_FLOW:SKIP"
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

  # Step 6: 保存参数到状态文件（供 confirm/mismatch 使用）
  save_auth_state || return 1

  # Step 7: 有效期转换（对非数字做防护）
  if [[ "$EXPIRES_IN" =~ ^[0-9]+$ ]] && [ "$EXPIRES_IN" -ge 60 ]; then
    EXPIRES_MIN=$((EXPIRES_IN / 60))
    EXPIRES_DISPLAY="${EXPIRES_MIN} 分钟"
  elif [[ "$EXPIRES_IN" =~ ^[0-9]+$ ]]; then
    EXPIRES_DISPLAY="${EXPIRES_IN} 秒"
  else
    EXPIRES_DISPLAY="10 分钟"
  fi

  # Step 8: 受控打开并由统一目录渲染授权信息；临时 URL 只通过 stdin 传递。
  OPEN_HELPER="${SCRIPT_DIR}/../../../normal/scripts/open_official_url.sh"
  OPEN_STATUS=$(printf '%s\n' "$BROWSER_URL" | bash "$OPEN_HELPER" authorization)
  case "$OPEN_STATUS" in OPENED|OPEN_FAILED|GUI_UNAVAILABLE|LINK_ONLY) ;; *) OPEN_STATUS="OPEN_FAILED" ;; esac
  DISPLAY_CODE="${VERIFICATION_CODE:-（请查看支付宝授权页面）}"
  MESSAGE_INPUT=$(printf '%s\n' "$PRODUCT_NAME" "$DEVICE_CODE" "$MCC_CODE" "$MCC_NAME" "$DISPLAY_CODE" "$EXPIRES_DISPLAY" "$BROWSER_URL" | jq -Rs '
    split("\n") as $v | {productName:$v[0],deviceCode:$v[1],mccCode:$v[2],mccName:$v[3],verificationCode:$v[4],expiresDisplay:$v[5],officialUrl:$v[6]}
  ')
  if ! printf '%s' "$MESSAGE_INPUT" | ALIPAY_AIPAY_RENDERER_MANAGED_CALLER=auth.sh node "$RENDERER" auth.page --variant DEFAULT; then
    cleanup_auth_state
    echo "AUTH_FLOW:FAILED"
    exit 1
  fi
  echo ""
  echo "AUTH_FLOW:READY"
}

# ─── auth confirm: 授权确认 + scope 校验 + MCC 授权有效性校验 ────────────────
auth_confirm() {
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
  LOGIN_COMPLETE_RESULT=$(run_json_command "alipay-cli login --complete --json" alipay-cli login --complete --json) || {
    auth_cli_environment_failure "授权完成确认"
    return 1
  }

  # Step 2: 判断授权结果
  # alipay-cli login --complete 返回：外层 .success + .data.status
  OUTER_SUCCESS=$(echo "$LOGIN_COMPLETE_RESULT" | jq -r '.success // false')
  DATA_STATUS=$(echo "$LOGIN_COMPLETE_RESULT" | jq -r '.data.status // ""')
  ERROR_CODE=$(echo "$LOGIN_COMPLETE_RESULT" | jq -r '.data.error.code // ""')

  if [ "$OUTER_SUCCESS" = "true" ] || [ "$DATA_STATUS" = "already_logged_in" ] || [ "$DATA_STATUS" = "completed" ]; then
    echo "✅ 授权确认成功"
  elif [ "$ERROR_CODE" = "authorization_pending" ]; then
    if ! printf '%s' '{}' | ALIPAY_AIPAY_RENDERER_MANAGED_CALLER=auth.sh node "$RENDERER" auth.pending --variant DEFAULT; then
      echo "AUTH_FLOW:FAILED"
      return 1
    fi
    echo "AUTH_FLOW:PENDING"
    return 0
  elif [ "$ERROR_CODE" = "auth_expired" ]; then
    cleanup_auth_state
    if ! printf '%s' '{}' | ALIPAY_AIPAY_RENDERER_MANAGED_CALLER=auth.sh node "$RENDERER" auth.expired --variant DEFAULT; then
      echo "AUTH_FLOW:FAILED"
      return 1
    fi
    echo "AUTH_FLOW:EXPIRED"
    return 0
  else
    if handle_error "$LOGIN_COMPLETE_RESULT"; then
      echo "❌ 授权确认失败：返回结果未包含可识别的完成状态"
    fi
    cleanup_auth_state
    echo "AUTH_FLOW:FAILED"
    return 1
  fi

  # Step 3: 复用 init 的 scope + MCC 授权有效性校验
  WHOAMI_RESULT=$(run_json_command "alipay-cli whoami --json" alipay-cli whoami --json) || {
    auth_cli_environment_failure "授权后登录状态复核"
    return 1
  }
  validate_current_authorization "$WHOAMI_RESULT" || return 1
  cleanup_auth_state
  echo "AUTH_FLOW:AUTH_SUCCESS"
  return 0
}

# ─── auth mismatch: 授权范围不满足 → logout → 重新授权 ──────────────────────
auth_mismatch() {
  local logout_result logout_error_type

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
  echo "⚠️ 当前授权范围或经营类目不匹配，需要退出当前登录并重新生成授权页面。"
  logout_result=$(run_json_command "alipay-cli logout --json" alipay-cli logout --json) || {
    auth_cli_environment_failure "退出当前登录"
    return 1
  }
  logout_error_type=$(detect_error "$logout_result")
  if [ "$logout_error_type" != "SUCCESS" ]; then
    echo "❌ 退出当前登录失败，已停止重新授权"
    echo "AUTH_FLOW:FAILED"
    return 1
  fi
  echo "✅ 已退出当前登录"

  # Step 3: 调用 auth init 执行登录 + 构建授权链接 + 输出授权信息
  # DEV_TOOL_NAME 已 export，子进程可继承
  echo "📋 请使用新的授权页面完成支付宝扫码授权"
  echo ""

  auth_init \
    --scope "$SCOPE" \
    --sales-code "$SALES_CODE" \
    --mcc-code "$MCC_CODE" \
    --product-name "${PRODUCT_NAME:-}" \
    --mcc-name "${MCC_NAME:-}"
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
  mismatch)
    shift
    auth_mismatch "$@"
    ;;
  *)
    echo "用法: bash auth.sh <init|confirm|mismatch> [参数...]"
    echo ""
    echo "  auth init    --scope <scope> --sales-code <code> --mcc-code <code> --product-name <name> --mcc-name <name>"
    echo "  auth confirm [--scope <scope> --sales-code <code> --mcc-code <code> --product-name <name> --mcc-name <name>]"
    echo "  auth mismatch [--scope <scope> --sales-code <code> --mcc-code <code> --product-name <name> --mcc-name <name>]"
    exit 1
    ;;
esac
