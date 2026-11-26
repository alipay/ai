#!/bin/bash

# Sensitive sandbox fields are held in shell variables below; never inherit
# caller tracing into the parsing and persistence path.
set +x
set -u

MODE="${1:-}"
PRODUCT_TYPE=""
PROJECT_PATH=""
CORE=""
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NORMAL_SCRIPTS="${SCRIPT_DIR}/../../normal/scripts"
RENDERER="${NORMAL_SCRIPTS}/render_customer_message.mjs"
DETECTOR="${NORMAL_SCRIPTS}/detect_dev_tool.sh"
COMMON_SCRIPT="${NORMAL_SCRIPTS}/common.sh"
CORE="${SCRIPT_DIR}/sandbox_config_core.mjs"

if [ -f "$COMMON_SCRIPT" ]; then
  # shellcheck source=/dev/null
  source "$COMMON_SCRIPT"
else
  echo "SANDBOX_ERROR:缺少公共脚本 $COMMON_SCRIPT" >&2
  exit 1
fi

# A legacy language argument is accepted for installed callers, but never
# controls sandbox creation or which credentials must be present.
node "$CORE" parse "$@" || exit 2
if [ "$MODE" = "summary" ]; then
  PRODUCT_TYPE="${2:-}"
  PROJECT_PATH="${3:-}"
else
  PROJECT_PATH="${2:-}"
fi
CONFIG_PATH="${PROJECT_PATH}/.alipay-sandbox.json"
CONTROL_CONFIG_PATH="$CONFIG_PATH"
case "$(uname -s)" in MINGW*|MSYS*) CONTROL_CONFIG_PATH=$(cygpath -m "$CONFIG_PATH") || exit 1 ;; esac

emit_sandbox_metric() {
  case "${ALIPAY_AIPAY_SANDBOX_PRODUCT:-}" in
    token-subscription) return 0 ;;
    *) emit_stage_metric "integration.create_sandbox" ;;
  esac
}

render_pending() {
  if [ "${ALIPAY_AIPAY_SANDBOX_PRODUCT:-}" != "token-subscription" ]; then
    printf '%s' '{}' | node "$RENDERER" sandbox.configuration.pending --variant "$PENDING_VARIANT" || {
      echo "SANDBOX_ERROR:沙箱待配置消息渲染失败" >&2
      return 1
    }
    emit_control "CUSTOMER_MESSAGE_DELIVERY_REQUIRED=sandbox.configuration.pending" || return 1
  fi
  emit_control_field "SANDBOX_PENDING_PATH" "$CONTROL_CONFIG_PATH" || return 1
  emit_control "$PENDING_MARKER"
}

if [ "$MODE" = "verify" ] || [ "$MODE" = "summary" ]; then
  node "$CORE" "$@"
  rc=$?
  if [ "$rc" -eq 0 ] && [ "$MODE" = "verify" ]; then emit_sandbox_metric; fi
  exit "$rc"
fi

if [ "$MODE" = "ensure" ] || [ "$MODE" = "reverify" ]; then
  if [ "$MODE" = "reverify" ] || [ -e "$CONFIG_PATH" ] || [ -L "$CONFIG_PATH" ]; then
    ENSURE_MODE="verify"
    ENSURE_ACTION="VERIFIED"
    PENDING_VARIANT="VERIFY"
    PENDING_MARKER="FLOW:SANDBOX_CONFIG_PENDING_VERIFY"
  else
    ENSURE_MODE="create"
    ENSURE_ACTION="CREATED"
    PENDING_VARIANT="CREATE"
    PENDING_MARKER="FLOW:SANDBOX_CONFIG_PENDING_CREATE"
  fi

  attempt=1
  while true; do
    ensure_output=$(bash "$0" "$ENSURE_MODE" "$PROJECT_PATH" 2>&1)
    ensure_rc=$?
    if [ "$ensure_rc" -eq "$ALIPAY_CLI_LOCAL_STATE_PERMISSION_EXIT_CODE" ] &&
       [ "$(printf '%s\n' "$ensure_output" | grep -Fxc 'ALIPAY_AIPAY_INTERNAL:SANDBOX_LOCAL_FS_PERMISSION_MODE=CREATE')" -eq 1 ] &&
       [ "$(printf '%s\n' "$ensure_output" | grep -Fxc 'ALIPAY_AIPAY_INTERNAL:CLI_FLOW:RETRY_WITH_LOCAL_FS_PERMISSION')" -eq 1 ]; then
      render_pending || exit 1
      emit_control "SANDBOX_LOCAL_FS_PERMISSION_MODE=CREATE"
      emit_control "CLI_FLOW:RETRY_WITH_LOCAL_FS_PERMISSION"
      exit "$ALIPAY_CLI_LOCAL_STATE_PERMISSION_EXIT_CODE"
    fi
    if [ "$ensure_rc" -eq 0 ] &&
       [ "$(printf '%s\n' "$ensure_output" | grep -Fxc "ALIPAY_AIPAY_INTERNAL:SANDBOX_CONFIG_PATH=$CONTROL_CONFIG_PATH")" -eq 1 ] &&
       [ "$(printf '%s\n' "$ensure_output" | grep -Fxc 'ALIPAY_AIPAY_INTERNAL:FLOW:SANDBOX_CONFIG_READY')" -eq 1 ] &&
       ! printf '%s\n' "$ensure_output" | grep -q '^SANDBOX_ERROR:'; then
      emit_control_field "SANDBOX_ENSURE_ACTION" "$ENSURE_ACTION" || exit 1
      emit_control_field "SANDBOX_CONFIG_PATH" "$CONTROL_CONFIG_PATH" || exit 1
      emit_control "FLOW:SANDBOX_CONFIG_READY"
      exit 0
    fi

    if [ "$ENSURE_MODE" = "create" ] && [ "$attempt" -lt 3 ] && printf '%s\n' "$ensure_output" | grep -qE \
      'SANDBOX_ERROR:MISSING_FIELDS'; then
      attempt=$((attempt + 1))
      sleep 3
      continue
    fi
    break
  done

  # Only controlled diagnostics may cross the CLI capture boundary.
  printf '%s\n' "$ensure_output" | sed -n 's/^SANDBOX_ERROR:/ALIPAY_AIPAY_INTERNAL:SANDBOX_PENDING_REASON=/p' >&2
  render_pending || exit 1
  exit 0
fi

extract_json_payload() {
  local raw="$1" line_count span start end candidate normalized selected="" match_count=0
  if normalized=$(printf '%s' "$raw" | jq -sce 'if length == 1 and (.[0] | type == "object") then .[0] else empty end' 2>/dev/null); then
    printf '%s' "$normalized"
    return 0
  fi

  line_count=$(printf '%s\n' "$raw" | awk 'END { print NR }')
  span="$line_count"
  while [ "$span" -ge 1 ]; do
    start=1
    while [ $((start + span - 1)) -le "$line_count" ]; do
      end=$((start + span - 1))
      candidate=$(printf '%s\n' "$raw" | sed -n "${start},${end}p")
      if normalized=$(printf '%s' "$candidate" | jq -sce 'if length == 1 and (.[0] | type == "object") then .[0] else empty end' 2>/dev/null) &&
         printf '%s' "$normalized" | jq -e 'has("success") or ((.result.content[0].text? // .content[0].text?) | type == "string")' >/dev/null 2>&1; then
        if [ "$normalized" != "$selected" ]; then
          selected="$normalized"
          match_count=$((match_count + 1))
        fi
      fi
      start=$((start + 1))
    done
    span=$((span - 1))
  done
  [ "$match_count" -eq 1 ] || return 1
  printf '%s' "$selected"
}

render_create_failure() {
  local error_code trace_id
  error_code=$(printf '%s' "$business" | jq -r '
    if (.errorCode? | type) == "string" and (.errorCode | test("^[A-Za-z0-9_.:-]{1,80}$"))
    then .errorCode else "UNKNOWN" end
  ' 2>/dev/null) || error_code="UNKNOWN"
  trace_id=$(printf '%s' "$business" | jq -r '
    if (.traceId? | type) == "string" and (.traceId | test("^[A-Za-z0-9_.:-]{1,128}$"))
    then .traceId else "未返回" end
  ' 2>/dev/null) || trace_id="未返回"
  printf 'SANDBOX_ERROR:%s traceId=%s\n' "$error_code" "$trace_id" >&2
}

if [ "$MODE" = "create" ]; then
  command -v alipay-cli >/dev/null 2>&1 || { echo "SANDBOX_ERROR:缺少 alipay-cli" >&2; exit 1; }
  node "$CORE" prepare-create "$PROJECT_PATH" || exit 1
  LOCK_PATH="${PROJECT_PATH}/.alipay-sandbox.lock"
  (umask 077; mkdir "$LOCK_PATH") 2>/dev/null || { echo "SANDBOX_ERROR:CONFIG_BUSY" >&2; exit 1; }
  trap 'rmdir "$LOCK_PATH" 2>/dev/null || true' EXIT
  # Recheck after taking the lock; another creator may have just finished.
  node "$CORE" prepare-create "$PROJECT_PATH" || exit 1
  PLATFORM=$(bash "$DETECTOR") || PLATFORM="unknown"
  init_platform_id
  init_alipay_cli_biz_info || { echo "SANDBOX_ERROR:无法初始化 alipay-cli 业务上报信息" >&2; exit 1; }
  if ! require_alipay_cli_local_state_access; then
    emit_control "SANDBOX_LOCAL_FS_PERMISSION_MODE=CREATE"
    emit_control "CLI_FLOW:RETRY_WITH_LOCAL_FS_PERMISSION"
    exit "$ALIPAY_CLI_LOCAL_STATE_PERMISSION_EXIT_CODE"
  fi
  attempt=1
  while true; do
    raw=$(env -u PRODUCT PLATFORM="$PLATFORM" PLATFORM_ID="${PLATFORM_ID:-}" ALIPAYCLI_BIZ_INFO="$ALIPAYCLI_BIZ_INFO" alipay-cli mcp call alipay-anonymous-sandbox.createAnonymousSandbox --data '{"request":{"appType":"PUBLICAPP"}}' --json 2>&1)
    rc=$?
    if alipay_cli_has_local_state_permission_error "$raw"; then
      echo "SANDBOX_ERROR:快速沙箱创建结果不明，禁止自动重复创建" >&2
      exit 1
    fi
    [ "$rc" -eq 0 ] && break
    if printf '%s' "$raw" | grep -qiE '版本过旧|version.*old'; then break; fi
    if [ "$attempt" -lt 3 ] && printf '%s' "$raw" | grep -qiE 'MCP_SERVICE_ERROR|SERVICE_UNSTABLE|timeout|timed out|connection|network|ECONN|socket|temporar'; then
      attempt=$((attempt + 1))
      sleep 3
      continue
    fi
    break
  done
  [ "$rc" -eq 0 ] || { echo "SANDBOX_ERROR:快速沙箱 CLI 调用失败" >&2; exit 1; }
  outer=$(extract_json_payload "$raw") || { echo "SANDBOX_ERROR:CLI 输出中未找到唯一合法 JSON 对象" >&2; exit 1; }
  text=$(echo "$outer" | jq -r '.result.content[0].text // .content[0].text // empty')
  if [ -n "$text" ]; then
    business=$(printf '%s' "$text" | jq -c . 2>/dev/null) || { echo "SANDBOX_ERROR:content[0].text 不是合法 JSON" >&2; exit 1; }
  else
    business="$outer"
  fi
  if [ "$(echo "$business" | jq -r '.success // false')" != "true" ] && echo "$business" | jq -r '.msg // .resultMsg // ""' | grep -q '证书密钥'; then
    sleep 2
    raw=$(env -u PRODUCT PLATFORM="$PLATFORM" PLATFORM_ID="${PLATFORM_ID:-}" ALIPAYCLI_BIZ_INFO="$ALIPAYCLI_BIZ_INFO" alipay-cli mcp call alipay-anonymous-sandbox.createAnonymousSandbox --data '{"request":{"appType":"PUBLICAPP"}}' --json 2>&1)
    rc=$?
    if alipay_cli_has_local_state_permission_error "$raw"; then
      echo "SANDBOX_ERROR:快速沙箱创建结果不明，禁止自动重复创建" >&2
      exit 1
    fi
    [ "$rc" -eq 0 ] || { echo "SANDBOX_ERROR:证书密钥临时错误重试后 CLI 调用失败" >&2; exit 1; }
    outer=$(extract_json_payload "$raw") || { echo "SANDBOX_ERROR:重试输出中未找到唯一合法 JSON 对象" >&2; exit 1; }
    text=$(echo "$outer" | jq -r '.result.content[0].text // .content[0].text // empty')
    if [ -n "$text" ]; then business=$(printf '%s' "$text" | jq -c . 2>/dev/null) || { echo "SANDBOX_ERROR:重试 content[0].text 非法" >&2; exit 1; }; else business="$outer"; fi
  fi
  [ "$(echo "$business" | jq -r '.success // false')" = "true" ] || {
    render_create_failure
    exit 1
  }
  data=$(echo "$business" | jq -c '.data // null') || exit 1
  printf '%s' "$data" | node "$CORE" persist "$PROJECT_PATH" || exit 1
else
  echo "SANDBOX_ERROR:INVALID_ARGUMENTS" >&2
  exit 2
fi

emit_control_field "SANDBOX_CONFIG_PATH" "$CONTROL_CONFIG_PATH" || exit 1
emit_control "FLOW:SANDBOX_CONFIG_READY"
emit_sandbox_metric
