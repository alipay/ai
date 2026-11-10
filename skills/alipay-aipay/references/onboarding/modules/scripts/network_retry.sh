#!/bin/bash

# Source after error_handler.sh. This wrapper never changes MCP argv or business JSON.

NETWORK_RETRY_CLASS=""
NETWORK_DISPATCH_STATE=""
NETWORK_ATTEMPTS=0

network_retry_is_local_transport_error() {
  printf '%s' "$1" | grep -Eqi \
    'network[ _]error|网络连接失败|could not resolve host|name or service not known|nodename nor servname|connection refused|failed to connect|fetch failed|socket hang up|econn(refused|reset)|enotfound|eai_again|etimedout|(^|[^[:alpha:]])timeout([^[:alpha:]]|$)|timed out|tls[^[:cntrl:]]*(error|failed|failure)|network access[^[:cntrl:]]*(denied|blocked)[^[:cntrl:]]*before connection'
}

network_retry_is_not_sent() {
  printf '%s' "$1" | grep -Eqi \
    'could not resolve host|name or service not known|nodename nor servname|connection refused|network access[^[:cntrl:]]*(denied|blocked)[^[:cntrl:]]*before connection'
}

network_retry_is_explicit_network_restriction() {
  printf '%s' "$1" | grep -Eqi \
    'network access[^[:cntrl:]]*(denied|blocked)[^[:cntrl:]]*before connection'
}

network_retry_emit_exhausted() {
  local action_name="$1" classification="$2" dispatch="$3" attempt="$4" evidence="$5"
  local recovery="NONE"
  if network_retry_is_local_transport_error "$evidence"; then
    recovery="RETRY_WITH_NETWORK"
  fi
  echo "ALIPAY_AIPAY_INTERNAL:NETWORK_RETRY_EXHAUSTED=${action_name}:${classification}:${dispatch}:${attempt}:${recovery}" >&2
}

run_network_retry() {
  local result_var="$1" operation="$2" action_name="$3"
  shift 3
  [ "${1:-}" = "--" ] || { echo "NETWORK_RETRY_ERROR:缺少 -- 参数分隔符" >&2; return 64; }
  shift
  [ "$#" -gt 0 ] || { echo "NETWORK_RETRY_ERROR:缺少命令 argv" >&2; return 64; }
  case "$operation" in read|write) ;; *) echo "NETWORK_RETRY_ERROR:operation 必须为 read 或 write" >&2; return 64 ;; esac

  local max_retries="${NETWORK_RETRY_MAX_RETRIES:-2}"
  local delay_seconds="${NETWORK_RETRY_DELAY_SECONDS:-3}"
  local attempt=0 stdout_file stderr_file stdout stderr combined result_payload rc classification transient dispatch
  stdout_file=$(mktemp "${TMPDIR:-/tmp}/alipay-aipay-stdout.XXXXXX") || return 1
  stderr_file=$(mktemp "${TMPDIR:-/tmp}/alipay-aipay-stderr.XXXXXX") || { rm -f "$stdout_file"; return 1; }
  chmod 600 "$stdout_file" "$stderr_file" 2>/dev/null || true
  trap 'rm -f "$stdout_file" "$stderr_file"; trap - RETURN' RETURN

  while true; do
    attempt=$((attempt + 1))
    : > "$stdout_file"
    : > "$stderr_file"
    "$@" >"$stdout_file" 2>"$stderr_file"
    rc=$?
    stdout=$(cat "$stdout_file")
    stderr=$(cat "$stderr_file")
    combined=$(printf '%s\n%s' "$stdout" "$stderr")
    classification=""
    transient=false
    dispatch="MAYBE_SENT"

    if type alipay_cli_has_local_state_permission_error >/dev/null 2>&1 &&
       alipay_cli_has_local_state_permission_error "$combined"; then
      NETWORK_RETRY_CLASS="CLI_LOCAL_FS_PERMISSION"
      NETWORK_DISPATCH_STATE="MAYBE_SENT"
      NETWORK_ATTEMPTS="$attempt"
      printf -v "$result_var" '%s' "$stdout"
      if [ "$operation" = "read" ]; then
        if [ "${ALIPAY_AIPAY_SUPPRESS_LOCAL_FS_RETRY_MARKER:-0}" != "1" ]; then
          emit_control "CLI_FLOW:RETRY_WITH_LOCAL_FS_PERMISSION"
        fi
        return "${ALIPAY_CLI_LOCAL_STATE_PERMISSION_EXIT_CODE:-77}"
      fi
      return 75
    fi

    local stdout_is_business_json=false unwrapped_stdout=""
    if [ -n "$stdout" ]; then
      classification=$(detect_error "$stdout" 2>/dev/null || true)
      unwrapped_stdout=$(unwrap_mcp "$stdout" 2>/dev/null || true)
      if printf '%s' "$unwrapped_stdout" | jq -e . >/dev/null 2>&1; then
        stdout_is_business_json=true
      fi
      # 合法业务 JSON 始终以 stdout 为准。普通启动日志会被 detect_error 归为
      # CLI_ERROR；此时仍须检查 stderr，避免真实连接失败被非空 stdout 掩盖。
      if [ "$stdout_is_business_json" != true ] && [ "$rc" -ne 0 ] && [ -n "$stderr" ]; then
        classification=$(detect_error "$stderr" 2>/dev/null || true)
      fi
    elif [ -n "$stderr" ]; then
      classification=$(detect_error "$stderr" 2>/dev/null || true)
    fi

    case "$classification" in
      MCP_SERVICE_ERROR|SERVICE_UNSTABLE) transient=true ;;
      *)
        if [ "$stdout_is_business_json" != true ] && { [ "$rc" -ne 0 ] || [ -n "$stderr" ]; } && network_retry_is_local_transport_error "$stderr"; then
          classification="LOCAL_TRANSPORT_ERROR"
          transient=true
        fi
        ;;
    esac

    if network_retry_is_not_sent "$stderr"; then
      dispatch="NOT_SENT"
    fi

    NETWORK_RETRY_CLASS="$classification"
    NETWORK_DISPATCH_STATE="$dispatch"
    NETWORK_ATTEMPTS="$attempt"
    result_payload="$stdout"
    if [ "$stdout_is_business_json" != true ] && [ "$rc" -ne 0 ] && [ -n "$stderr" ]; then
      result_payload="$stderr"
    fi
    printf -v "$result_var" '%s' "$result_payload"

    if [ "$transient" != true ]; then
      return 0
    fi

    if [ "$operation" = "write" ] && [ "$dispatch" != "NOT_SENT" ]; then
      return 75
    fi

    if network_retry_is_explicit_network_restriction "$combined"; then
      network_retry_emit_exhausted "$action_name" "$classification" "$dispatch" "$attempt" "$combined"
      return 76
    fi

    if [ "$attempt" -gt "$max_retries" ]; then
      network_retry_emit_exhausted "$action_name" "$classification" "$dispatch" "$attempt" "$combined"
      return 76
    fi
    sleep "$delay_seconds"
  done
}
