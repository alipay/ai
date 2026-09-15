#!/bin/bash
#=============================================================================
# 脚本名称: common.sh
# 功能描述: 集成流程和签约流程共用的 shell 基础函数
# 调用前置: 无
#=============================================================================

case "${HOME:-}" in
  /*)
    user_bin="$HOME/.local/bin"
    if [ "$HOME" != "/" ] && { [ -x "$user_bin/jq" ] || [ -x "$user_bin/alipay-cli" ]; }; then
      case ":${PATH:-}:" in
        *":$user_bin:"*) ;;
        *) PATH="${PATH:+$PATH:}$user_bin"; export PATH ;;
      esac
      if ! command -v jq >/dev/null 2>&1 \
        || ! jq --version >/dev/null 2>&1 \
        || ! jq -n -e --arg value ok '$value == "ok"' >/dev/null 2>&1; then
        if "$user_bin/jq" --version >/dev/null 2>&1 \
          && "$user_bin/jq" -n -e --arg value ok '$value == "ok"' >/dev/null 2>&1; then
          jq() { "$HOME/.local/bin/jq" "$@"; }
        fi
      fi
    fi
    unset user_bin
    ;;
esac

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "❌ 缺少依赖命令: $1"
    return 1
  fi
}

ALIPAY_CLI_LOCAL_STATE_PERMISSION_EXIT_CODE=77
ALIPAY_CLI_LOCAL_STATE_ACCESS_CONFIRMED=false
ALIPAY_AIPAY_LOCAL_CONFIG_PERMISSION_EXIT_CODE=77
ALIPAY_AIPAY_LOCAL_CONFIG_ACCESS_CONFIRMED=false

alipay_cli_credentials_dir() {
  case "${HOME:-}" in
    /*) [ "$HOME" != "/" ] || return "$ALIPAY_CLI_LOCAL_STATE_PERMISSION_EXIT_CODE" ;;
    *) return "$ALIPAY_CLI_LOCAL_STATE_PERMISSION_EXIT_CODE" ;;
  esac
  printf '%s/.alipay-cli/credentials' "$HOME"
}

alipay_cli_logs_dir() {
  local data_home="${XDG_DATA_HOME:-}"
  if [ -z "$data_home" ]; then
    case "${HOME:-}" in
      /*) [ "$HOME" != "/" ] || return "$ALIPAY_CLI_LOCAL_STATE_PERMISSION_EXIT_CODE" ;;
      *) return "$ALIPAY_CLI_LOCAL_STATE_PERMISSION_EXIT_CODE" ;;
    esac
    data_home="$HOME/.local/share"
  fi
  case "$data_home" in
    /*) ;;
    *) return "$ALIPAY_CLI_LOCAL_STATE_PERMISSION_EXIT_CODE" ;;
  esac
  printf '%s/alipay-cli/logs' "$data_home"
}

alipay_cli_has_local_state_permission_error() {
  local raw="${1:-}" permission_pattern private_state_pattern local_state_failure_pattern
  [ -n "$raw" ] || return 1

  permission_pattern='permission denied|operation not permitted|(^|[^[:alnum:]_])(EACCES|EPERM)([^[:alnum:]_]|$)'
  private_state_pattern='poll_state\.enc\.tmp|session\.enc|\.alipay-cli[/\\]credentials|alipay-cli[/\\]logs'
  local_state_failure_pattern='写入临时文件失败|删除凭据文件失败|can.?t rename log file'

  printf '%s' "$raw" | grep -qiE "$local_state_failure_pattern" && return 0
  printf '%s' "$raw" | grep -qiE "$permission_pattern" || return 1
  printf '%s' "$raw" | grep -qiE "$private_state_pattern"
}

probe_private_writable_dir() {
  local state_dir="$1" prefix="$2" failure_code="$3" probe_file="" renamed_file=""
  [ -d "$state_dir" ] || mkdir -p "$state_dir" 2>/dev/null || return "$failure_code"
  probe_file=$(mktemp "$state_dir/${prefix}.XXXXXX" 2>/dev/null) || return "$failure_code"
  chmod 600 "$probe_file" 2>/dev/null || { rm -f "$probe_file" 2>/dev/null || true; return "$failure_code"; }
  if ! printf 'alipay-aipay-local-access\n' >"$probe_file" 2>/dev/null; then
    rm -f "$probe_file" 2>/dev/null || true
    return "$failure_code"
  fi
  renamed_file="${probe_file}.renamed"
  if ! mv "$probe_file" "$renamed_file" 2>/dev/null; then
    rm -f "$probe_file" "$renamed_file" 2>/dev/null || true
    return "$failure_code"
  fi
  rm -f "$renamed_file" 2>/dev/null || { rm -f "$renamed_file" 2>/dev/null || true; return "$failure_code"; }
}

require_alipay_cli_local_state_access() {
  local state_dir
  if [ "$ALIPAY_CLI_LOCAL_STATE_ACCESS_CONFIRMED" = true ]; then
    return 0
  fi

  for state_dir in "$(alipay_cli_credentials_dir)" "$(alipay_cli_logs_dir)"; do
    probe_private_writable_dir "$state_dir" ".alipay-aipay-access" "$ALIPAY_CLI_LOCAL_STATE_PERMISSION_EXIT_CODE" \
      || return "$ALIPAY_CLI_LOCAL_STATE_PERMISSION_EXIT_CODE"
  done

  ALIPAY_CLI_LOCAL_STATE_ACCESS_CONFIRMED=true
}

require_alipay_cli_local_state_access_or_emit() {
  if require_alipay_cli_local_state_access; then
    return 0
  fi
  emit_control "CLI_FLOW:RETRY_WITH_LOCAL_FS_PERMISSION"
  return "$ALIPAY_CLI_LOCAL_STATE_PERMISSION_EXIT_CODE"
}

alipay_aipay_config_dir() {
  local config_home="${XDG_CONFIG_HOME:-}"
  if [ -z "$config_home" ]; then
    case "${HOME:-}" in
      /*) [ "$HOME" != "/" ] || return "$ALIPAY_AIPAY_LOCAL_CONFIG_PERMISSION_EXIT_CODE" ;;
      *) return "$ALIPAY_AIPAY_LOCAL_CONFIG_PERMISSION_EXIT_CODE" ;;
    esac
    config_home="$HOME/.config"
  fi
  case "$config_home" in
    /*) ;;
    *) return "$ALIPAY_AIPAY_LOCAL_CONFIG_PERMISSION_EXIT_CODE" ;;
  esac
  printf '%s' "$config_home"
}

require_alipay_aipay_config_write_access() {
  local config_dir
  if [ "$ALIPAY_AIPAY_LOCAL_CONFIG_ACCESS_CONFIRMED" = true ]; then
    return 0
  fi

  config_dir="$(alipay_aipay_config_dir)" || return "$ALIPAY_AIPAY_LOCAL_CONFIG_PERMISSION_EXIT_CODE"
  probe_private_writable_dir "$config_dir" ".alipay-aipay-config-access" "$ALIPAY_AIPAY_LOCAL_CONFIG_PERMISSION_EXIT_CODE" \
    || return "$ALIPAY_AIPAY_LOCAL_CONFIG_PERMISSION_EXIT_CODE"

  ALIPAY_AIPAY_LOCAL_CONFIG_ACCESS_CONFIRMED=true
}

emit_control() {
  printf 'ALIPAY_AIPAY_INTERNAL:%s\n' "$*" >&2
}

validate_control_value() {
  local value="${1:-}"
  [ -n "$value" ] || return 1
  ! printf '%s' "$value" | LC_ALL=C grep -q '[[:cntrl:]]'
}

emit_control_field() {
  local name="${1:-}"
  local value="${2:-}"
  [[ "$name" =~ ^[A-Z][A-Z0-9_]*$ ]] || return 1
  validate_control_value "$value" || return 1
  printf 'ALIPAY_AIPAY_INTERNAL:%s=%s\n' "$name" "$value" >&2
}

init_dev_tool_name() {
  if [ -n "${DEV_TOOL_NAME:-}" ] && [ "$DEV_TOOL_NAME" != "unknown" ]; then
    export DEV_TOOL_NAME
    return
  fi

  local COMMON_DIR
  COMMON_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  local DETECT_SCRIPT="${COMMON_DIR}/detect_dev_tool.sh"

  if [ -f "$DETECT_SCRIPT" ]; then
    # shellcheck source=/dev/null
    source "$DETECT_SCRIPT"
    DEV_TOOL_NAME="$(detect_dev_tool 2>/dev/null || echo unknown)"
  fi

  export DEV_TOOL_NAME="${DEV_TOOL_NAME:-unknown}"
}

init_root_intent_context() {
  local candidate="${ALIPAY_AIPAY_ROOT_INTENT:-${ROOT_INTENT:-}}"
  case "$candidate" in
    integration_only|onboarding_only|full_process)
      ALIPAY_AIPAY_ROOT_INTENT="$candidate"
      export ALIPAY_AIPAY_ROOT_INTENT
      ;;
  esac
}

platform_project_id() {
  local candidate

  candidate="${COZE_PROJECT_ID:-${MEOO_PROJECT_ID:-}}"
  if valid_platform_id "$candidate"; then
    printf '%s' "$candidate"
    return 0
  fi

  if [ -n "${MIAODA:-}" ]; then
    candidate="${VITE_APP_ID:-${PLATFORM_ID:-}}"
    if valid_platform_id "$candidate"; then
      printf '%s' "$candidate"
      return 0
    fi
  fi

  return 1
}

valid_platform_id() {
  local value="${1:-}"
  [ -n "$value" ] || return 1
  printf '%s' "$value" | LC_ALL=C grep -q '[^[:space:]]' || return 1
  ! printf '%s' "$value" | LC_ALL=C grep -q '[[:cntrl:],^=]'
}

init_platform_id() {
  local candidate marker COMMON_DIR TELEMETRY_SCRIPT

  candidate="$(platform_project_id || true)"
  if valid_platform_id "$candidate"; then
    PLATFORM_ID="$candidate"
    export PLATFORM_ID
    return
  fi

  candidate="${ALIPAY_AIPAY_RUN_ID:-${ALIPAY_AIPAY_FLOW_RUN_ID:-}}"
  if valid_platform_id "$candidate"; then
    PLATFORM_ID="$candidate"
    export PLATFORM_ID
    return
  fi

  COMMON_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  TELEMETRY_SCRIPT="${COMMON_DIR}/telemetry.mjs"
  if [ ! -f "$TELEMETRY_SCRIPT" ] || ! command -v node >/dev/null 2>&1; then
    return
  fi

  marker="$(node "$TELEMETRY_SCRIPT" current-run-id 2>&1 >/dev/null || true)"
  candidate="$(printf '%s\n' "$marker" | sed -n 's/^ALIPAY_AIPAY_INTERNAL:RUN_ID=//p' | head -n 1)"
  if valid_platform_id "$candidate"; then
    PLATFORM_ID="$candidate"
    export PLATFORM_ID
    return
  fi

  if valid_platform_id "${PLATFORM_ID:-}"; then
    export PLATFORM_ID
  fi
}

init_alipay_cli_biz_info() {
  local common_dir version_file version skill_user_id

  common_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  version_file="${common_dir}/../../../VERSION"
  if [ ! -f "$version_file" ]; then
    echo "❌ 无法读取当前 alipay-aipay Skill 版本" >&2
    return 1
  fi
  version="$(<"$version_file")"

  if [[ ! "$version" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?(\+[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$ ]]; then
    echo "❌ 当前 alipay-aipay Skill VERSION 不是合法 SemVer" >&2
    return 1
  fi

  skill_user_id="$(machine_user_id_for_biz_info "$common_dir" || true)"
  if [[ "$skill_user_id" =~ ^machine_[0-9a-f]{32}$ ]]; then
    printf -v ALIPAYCLI_BIZ_INFO '{"skill":"alipay-aipay","skill_version":"v%s","skill_user_id":"%s"}' "$version" "$skill_user_id"
  else
    printf -v ALIPAYCLI_BIZ_INFO '{"skill":"alipay-aipay","skill_version":"v%s"}' "$version"
  fi
  export ALIPAYCLI_BIZ_INFO
}

machine_user_id_for_biz_info() {
  local common_dir="${1:-}" telemetry_script marker candidate

  if [ -z "$common_dir" ]; then
    common_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  fi
  telemetry_script="${common_dir}/telemetry.mjs"
  [ -f "$telemetry_script" ] && command -v node >/dev/null 2>&1 || return 1

  marker="$(node "$telemetry_script" machine-user-id 2>&1 >/dev/null || true)"
  candidate="$(printf '%s\n' "$marker" | sed -n 's/^ALIPAY_AIPAY_INTERNAL:MACHINE_USER_ID=//p' | head -n 1)"
  [[ "$candidate" =~ ^machine_[0-9a-f]{32}$ ]] || return 1
  printf '%s' "$candidate"
}

init_alipay_cli_context() {
  init_dev_tool_name
  init_root_intent_context
  init_platform_id
  init_alipay_cli_biz_info || return 1
  export PLATFORM="${DEV_TOOL_NAME:-unknown}"
}

alipay_cli_product_for_type() {
  case "${1:-}" in
    aipay) printf 'AIPAY' ;;
    webpay) printf 'WEBPAY' ;;
    apppay) printf 'APPPAY' ;;
    *) return 1 ;;
  esac
}

alipay_product_type_for_sales_code() {
  case "${1:-}" in
    I1080300001000160457) printf 'aipay' ;;
    I1080300001000041203) printf 'webpay' ;;
    I1080300001000041313) printf 'apppay' ;;
    *) return 1 ;;
  esac
}

init_alipay_cli_product() {
  local product_type="${1:-${ALIPAY_AIPAY_PRODUCT_TYPE:-}}"
  local cli_product

  cli_product="$(alipay_cli_product_for_type "$product_type")" || {
    echo "❌ 缺少或无法识别支付宝产品上下文（仅支持 aipay|webpay|apppay）" >&2
    return 1
  }
  ALIPAY_AIPAY_PRODUCT_TYPE="$product_type"
  PRODUCT="$cli_product"
  export ALIPAY_AIPAY_PRODUCT_TYPE PRODUCT
}

init_alipay_cli_product_from_sales_code() {
  local product_type
  product_type="$(alipay_product_type_for_sales_code "${1:-}")" || {
    echo "❌ 无法从 salesCode 解析支付宝产品上下文" >&2
    return 1
  }
  init_alipay_cli_product "$product_type"
}

emit_stage_metric() {
  local stage="${1:-}"
  local run_id="${ALIPAY_AIPAY_TELEMETRY_RUN_ID:-}"
  local history_count="${ALIPAY_AIPAY_TELEMETRY_HISTORY_COUNT:-null}"
  local common_dir telemetry_script telemetry_switch
  [ -n "$stage" ] || return 0
  [ -n "$run_id" ] || return 0
  telemetry_switch="$(printf '%s' "${ALIPAY_AIPAY_TELEMETRY:-}" | tr '[:upper:]' '[:lower:]')"
  case "$telemetry_switch" in
    0|false|off|no) return 0 ;;
  esac
  common_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  telemetry_script="${common_dir}/telemetry.mjs"
  [ -f "$telemetry_script" ] && command -v node >/dev/null 2>&1 || return 0
  if [ "${ALIPAY_AIPAY_TEST_MODE:-0}" = "1" ]; then
    node "$telemetry_script" stage "$stage" --run-id "$run_id" --history-count "$history_count"
  else
    node "$telemetry_script" stage "$stage" --run-id "$run_id" --history-count "$history_count" >/dev/null 2>&1
  fi
  return 0
}
