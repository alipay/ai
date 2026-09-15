#!/bin/bash
#=============================================================================
# 脚本名称: error_handler.sh
# 功能描述: 签约流程统一错误检测与处理，供所有 .sh 脚本 source 引用
# 源文件: error-handling.md（本文档为可执行版本）
# 用法: source scripts/error_handler.sh
#       if ! handle_error "$RESULT"; then return 1; fi
#=============================================================================

ERROR_HANDLER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMMON_SCRIPT="${ERROR_HANDLER_DIR}/../../../normal/scripts/common.sh"
ERROR_RENDERER="${ERROR_HANDLER_DIR}/../../../normal/scripts/render_customer_message.mjs"
if [ -f "$COMMON_SCRIPT" ]; then
  # shellcheck source=/dev/null
  source "$COMMON_SCRIPT"
  init_alipay_cli_context
else
  echo "❌ 缺少公共脚本: $COMMON_SCRIPT"
  return 1 2>/dev/null || exit 1
fi

render_error_message() {
  local MESSAGE_ID="$1" VARIANT="$2" INPUT_JSON="$3"
  if printf '%s' "$INPUT_JSON" \
    | ALIPAY_AIPAY_RENDERER_MANAGED_CALLER=error_handler.sh node "$ERROR_RENDERER" "$MESSAGE_ID" --variant "$VARIANT"; then
    [ "${ALIPAY_AIPAY_CAPTURE_CHILD_OUTPUT:-0}" != "1" ] || emit_control "CHILD_CUSTOMER_MESSAGE_RENDERED"
    return 0
  fi
  return 1
}

# ─── MCP 信封解包 ──────────────────────────────────────────────────────────
# alipay-cli mcp call 返回 MCP 协议信封：
#   { "content": [ { "text": "<业务JSON>", "type": "text" } ] }
# 业务 JSON（含 success / resultObj / errorCode）被包在 content[0].text 里。
# 本函数负责解包：若检测到信封结构，提取 content[0].text；否则原样返回。
# 当 stdout 混有日志时，只接受唯一可确定的 MCP 信封或 JSON；候选不唯一时
# 保留原始文本，让后续错误检测安全阻断，禁止猜测业务响应。
#
# 对于非 mcp call 的命令（如 alipay-cli login / whoami），返回不带信封，
# 保证这些命令的原样透传。
extract_unique_json() {
  local RAW="$1"
  printf '%s' "$RAW" | jq -Rsc '
    explode as $chars |
    reduce range(0; ($chars | length)) as $index (
      {
        depth: 0,
        start: null,
        in_string: false,
        escaped: false,
        raw_candidates: []
      };
      ($chars[$index]) as $char |
      if .depth == 0 then
        if $char == 123 or $char == 91 then
          .depth = 1 |
          .start = $index |
          .in_string = false |
          .escaped = false
        else
          .
        end
      elif .in_string then
        if .escaped then
          .escaped = false
        elif $char == 92 then
          .escaped = true
        elif $char == 34 then
          .in_string = false
        else
          .
        end
      elif $char == 34 then
        .in_string = true
      elif $char == 123 or $char == 91 then
        .depth += 1
      elif $char == 125 or $char == 93 then
        .depth -= 1 |
        if .depth == 0 then
          ($chars[.start:($index + 1)] | implode) as $candidate |
          .raw_candidates += [$candidate] |
          .start = null
        else
          .
        end
      else
        .
      end
    ) |
    [
      .raw_candidates[] |
      fromjson? |
      select(type == "object" or type == "array")
    ] |
    unique as $candidates |
    (
      $candidates |
      map(select(
        type == "object" and
        (.content | type) == "array" and
        any(.content[]?; (.text? | type) == "string")
      )) |
      unique
    ) as $envelopes |
    if ($envelopes | length) == 1 then
      {status: "ok", value: $envelopes[0]}
    elif ($envelopes | length) == 0 and ($candidates | length) == 1 then
      {status: "ok", value: $candidates[0]}
    elif ($candidates | length) == 0 then
      {status: "none"}
    else
      {status: "ambiguous"}
    end
  ' 2>/dev/null
}

# 对客错误详情只保留受限单行文本。解析和错误分类仍使用原始值，
# 但任何疑似凭据、临时 URL 或密钥内容都不能进入普通终端输出。
sanitize_customer_error_text() {
  local VALUE="${1:-}" NORMALIZED
  NORMALIZED=$(printf '%s' "$VALUE" | tr '\000-\037\177' ' ' | awk '{$1=$1; print}')
  if [ -z "$NORMALIZED" ]; then
    echo "未知错误"
    return
  fi
  if printf '%s' "$NORMALIZED" | grep -qiE '\{\{|\}\}|<INTERNAL_'; then
    echo "错误详情包含内部标记或模板占位符，已隐藏"
    return
  fi
  if printf '%s' "$NORMALIZED" | grep -qiE \
    'https?://|verification_url|device[_-]?code|authorization:[[:space:]]*bearer|payment-proof|-----BEGIN|private[_ -]?key|public[_ -]?key|["'\'']?(password|passwd|secret|api[_-]?key|access[_-]?token)["'\'']?[[:space:]]*[:=]|(^|[^[:alnum:]_])token[=:]'; then
    echo "错误详情包含临时链接或敏感字段，已隐藏"
    return
  fi
  printf '%s' "$NORMALIZED" | cut -c1-1000
}

unwrap_mcp() {
  local RAW="$1"
  if [ -z "$RAW" ]; then
    echo ""
    return
  fi

  local ANALYSIS STATUS JSON
  ANALYSIS=$(extract_unique_json "$RAW")
  STATUS=$(echo "$ANALYSIS" | jq -r '.status // "none"' 2>/dev/null)
  case "$STATUS" in
    ok)
      JSON=$(echo "$ANALYSIS" | jq -c '.value' 2>/dev/null)
      ;;
    ambiguous)
      echo "CLI 输出包含多个 JSON 候选，无法唯一解析"
      return
      ;;
    *)
      echo "$RAW"
      return
      ;;
  esac

  local TEXT
  TEXT=$(echo "$JSON" | jq -r '
    if (.content | type) == "array" then
      [ .content[]? | .text? | select(type == "string") ] as $texts |
      ([
        $texts[] |
        fromjson? |
        select(type == "object" or type == "array") |
        tojson
      ] | unique) as $jsonTexts |
      if ($jsonTexts | length) == 1 then
        $jsonTexts[0]
      elif ($jsonTexts | length) == 0 and ($texts | length) > 0 then
        $texts[0]
      else
        "CLI 输出包含多个 JSON 候选，无法唯一解析"
      end
    else
      empty
    end
  ' 2>/dev/null)
  if [ -n "$TEXT" ]; then
    echo "$TEXT"
  else
    echo "$JSON"
  fi
}

# ─── JSON 错误字段提取 ─────────────────────────────────────────────────────
# 部分 MCP 后端会把真实业务响应包在 data/response 或 errorContext.errorStack 下。
# 下面的提取函数优先定位同一个错误对象，避免 success=false 时丢失真实错误体。
extract_first_named_field() {
  local JSON="$1"
  local FIELD="$2"
  echo "$JSON" | jq -r --arg field "$FIELD" '
    [.. | objects | .[$field]? | select(. != null and (tostring != ""))][0] // ""
  ' 2>/dev/null
}

extract_error_object() {
  echo "$1" | jq -c '
    [
      .,
      (.error? | objects),
      (.data? | objects),
      (.data.error? | objects),
      (.response? | objects),
      (.data.response? | objects),
      (.errorContext.errorStack[]? | objects)
      |
      select(
        ((.errorCode? | type) == "string" and .errorCode != "") or
        ((.errorCode? | type) == "number") or
        ((.errorCode? | type) == "object" and
          (((.errorCode.code? // "") | tostring) != "" or
           (((.errorCode.status? // "") | tostring) != "")))
      )
    ][0] // empty
  ' 2>/dev/null
}

extract_error_code() {
  local ERROR_OBJECT
  ERROR_OBJECT=$(extract_error_object "$1")
  if [ -n "$ERROR_OBJECT" ]; then
    echo "$ERROR_OBJECT" | jq -r '
      if (.errorCode | type) == "string" then .errorCode
      elif (.errorCode | type) == "object" then (.errorCode.code // "")
      else ""
      end
    ' 2>/dev/null
    return
  fi

  echo ""
}

extract_error_message() {
  local JSON="$1"
  local ERROR_OBJECT
  ERROR_OBJECT=$(extract_error_object "$JSON")
  if [ -n "$ERROR_OBJECT" ]; then
    echo "$ERROR_OBJECT" | jq -r '
      .errorMessage //
      .errorMsg //
      .error.message //
      .message //
      (if (.errorCode | type) == "object" then (.errorCode.desc // .errorCode.message) else empty end) //
      "未知错误"
    ' 2>/dev/null
    return
  fi

  echo "$JSON" | jq -r '
    if .data.success? == false then
      [
        .data.subMsg?,
        .data.msg?,
        .subMsg?,
        .errorMessage?,
        .errorMsg?,
        .message?,
        (.error? | objects | .message?),
        .msg?,
        (
          .. | objects |
          (.errorMessage?, .errorMsg?, .message?, (.error? | objects | .message?))
        )
      ] |
      [
        .[] |
        select(
          . != null and
          (tostring != "") and
          ((tostring | ascii_downcase) != "success")
        )
      ][0] // "未知错误"
    else
      [
        .. | objects |
        (.errorMessage?, .errorMsg?, .message?, (.error? | objects | .message?)) |
        select(. != null and (tostring != ""))
      ][0] // "未知错误"
    end
  ' 2>/dev/null
}

extract_biz_tips() {
  local ERROR_OBJECT
  ERROR_OBJECT=$(extract_error_object "$1")
  if [ -n "$ERROR_OBJECT" ]; then
    echo "$ERROR_OBJECT" | jq -r '.bizTips // ""' 2>/dev/null
    return
  fi

  extract_first_named_field "$1" "bizTips"
}

extract_need_retry() {
  local JSON="$1"
  local ERROR_OBJECT
  ERROR_OBJECT=$(extract_error_object "$JSON")
  if [ -n "$ERROR_OBJECT" ]; then
    echo "$ERROR_OBJECT" | jq -r 'if .needRetry == true then "true" else "false" end' 2>/dev/null
    return
  fi

  echo "$JSON" | jq -r '
    if any(.. | objects; .needRetry? == true) then "true" else "false" end
  ' 2>/dev/null
}

extract_error_object_field() {
  local JSON="$1"
  local FIELD="$2"
  local ERROR_OBJECT
  ERROR_OBJECT=$(extract_error_object "$JSON")
  if [ -n "$ERROR_OBJECT" ]; then
    echo "$ERROR_OBJECT" | jq -r --arg field "$FIELD" '
      .[$field] //
      (if (.errorCode | type) == "object" then (.errorCode[$field] // "") else "" end)
    ' 2>/dev/null
    return
  fi

  extract_first_named_field "$JSON" "$FIELD"
}

extract_success_state() {
  local JSON="$1"
  echo "$JSON" | jq -r '
    if .success? == false or
       ((.data? | type) == "object" and .data.success? == false) or
       ((.response? | type) == "object" and .response.success? == false) or
       ((.data.response? | type) == "object" and .data.response.success? == false) then "false"
    elif .success? == true or
         ((.data? | type) == "object" and .data.success? == true) or
         ((.response? | type) == "object" and .response.success? == true) or
         ((.data.response? | type) == "object" and .data.response.success? == true) or
         (((.code? // "") | tostring) == "10000") then "true"
    else "null"
    end
  ' 2>/dev/null
}

extract_checked_errors() {
  local JSON="$1"
  echo "$JSON" | jq -c '
    [
      .. | objects |
      (
        .checkedError?,
        (.resultObj? | objects | .checkedError?),
        (.data? | objects | .checkedError?)
      ) |
      select(. != null)
    ][0] // empty
  ' 2>/dev/null
}

# ─── 统一错误检测 ──────────────────────────────────────────────────────────
# 参数: $1 - CLI 执行结果文本（原始输出，含信封或不含）
#       $2 - 可选调用上下文；MCP_AUTHENTICATED_CALL 允许识别资源响应中的明确未登录状态
# 返回: MCP_AUTH_ERROR | MCP_SERVICE_ERROR | AUTH_MISMATCH | SERVICE_UNSTABLE | CLI_LOCAL_FS_PERMISSION | ERROR:xxx | CLI_ERROR:xxx | SUCCESS
detect_error() {
  local CLI_RESULT="$1"
  local ERROR_CONTEXT="${2:-}"

  # 空输入视为异常，不应被当作 SUCCESS
  if [ -z "$CLI_RESULT" ]; then
    echo "CLI_ERROR:CLI 返回为空"
    return
  fi

  if alipay_cli_has_local_state_permission_error "$CLI_RESULT"; then
    echo "CLI_LOCAL_FS_PERMISSION"
    return
  fi

  # 先解包 MCP 信封，再进行错误检测
  local UNWRAPPED=$(unwrap_mcp "$CLI_RESULT")

  # 1. 优先检测 MCP 认证错误。非 JSON 只接受传输层强证据；JSON 只检查
  # 顶层响应和登记的 error/response 层，不递归扫描成功候选或示例数据。
  if ! echo "$UNWRAPPED" | jq -e . >/dev/null 2>&1; then
    if echo "$UNWRAPPED" | grep -qiE \
      "HTTP[[:space:]]*401|Authorization is empty|非法的?认证信息|用户未登录|not[ _-]+logged[ _-]+in|(authorization|authentication|login)[-[:space:]_:=]+(is[-[:space:]_:=]+)?required|(access|auth|authentication|authorization)[ _-]+token[-[:space:]_:=]+(is[-[:space:]_:=]+)?(missing|expired)|(^|[^[:alnum:]_])(missing|expired)[-[:space:]_:=]+(access|auth|authentication|authorization)[ _-]+token([^[:alnum:]_]|$)|(^|[^[:alnum:]_])token[-[:space:]_:=]+(is[-[:space:]_:=]+)?(missing|expired)([^[:alnum:]_]|$)"; then
      echo "MCP_AUTH_ERROR"
      return
    fi
  elif echo "$UNWRAPPED" | jq -e --arg context "$ERROR_CONTEXT" '
    def failure_shaped:
      type == "object" and (
        .success? == false or
        (.error? != null) or
        (.errorCode? != null) or
        ((.errorMessage? | type) == "string" and .errorMessage != "") or
        ((.errorMsg? | type) == "string" and .errorMsg != "") or
        (((.code? // "") | tostring) as $code |
          $code != "" and $code != "0" and $code != "10000")
      );
    def auth_code:
      if type != "string" and type != "number" then false
      else
        (tostring | ascii_downcase | gsub("^[[:space:]]+|[[:space:]]+$"; "")) as $code |
        ([
          "401",
          "unauthorized",
          "not_logged_in",
          "login_required",
          "unauthenticated",
          "authorization_required",
          "auth_required",
          "access_token_missing",
          "access_token_expired",
          "auth_token_missing",
          "auth_token_expired"
        ] | index($code) != null)
      end;
    def auth_message:
      type == "string" and test(
        "HTTP[[:space:]]*401|Authorization is empty|非法的?认证信息|用户未登录|not[ _-]+logged[ _-]+in|(authorization|authentication|login)[-[:space:]_:=]+(is[-[:space:]_:=]+)?required|(access|auth|authentication|authorization)[ _-]+token[-[:space:]_:=]+(is[-[:space:]_:=]+)?(missing|expired)|(^|[^[:alnum:]_])(missing|expired)[-[:space:]_:=]+(access|auth|authentication|authorization)[ _-]+token([^[:alnum:]_]|$)|(^|[^[:alnum:]_])token[-[:space:]_:=]+(is[-[:space:]_:=]+)?(missing|expired)([^[:alnum:]_]|$)";
        "i"
      );
    . as $root |
    ([
      $root,
      ($root.data? | objects | select(failure_shaped)),
      ($root.response? | objects | select(failure_shaped)),
      ($root.data.response? | objects | select(failure_shaped))
    ]) as $response_nodes |
    ([
      ($root.error? | objects),
      ($root.errorCode? | objects),
      ($root.data.error? | objects),
      ($root.data.errorCode? | objects),
      ($root.response.error? | objects),
      ($root.data.response.error? | objects),
      ($root.errorContext.errorStack[]? | objects)
    ]) as $error_nodes |
    (($response_nodes + $error_nodes) | any(.[];
      [
        .code?, .errorCode?, .status?, .reason?,
        (.errorCode? | objects | (.code?, .status?, .reason?))
      ] | any(.[]; auth_code)
    )) or
    ($response_nodes | any(.[];
      failure_shaped and
      ([.message?, .errorMessage?, .errorMsg?, .msg?, .subMsg?] | any(.[]; auth_message))
    )) or
    ($error_nodes | any(.[];
      [.message?, .errorMessage?, .errorMsg?, .msg?, .subMsg?] | any(.[]; auth_message)
    )) or
    ($context == "MCP_AUTHENTICATED_CALL" and (
      (($root.logged_in? | type) == "boolean" and $root.logged_in == false) or
      (($root.data? | type) == "object" and
        ($root.data.logged_in? | type) == "boolean" and $root.data.logged_in == false) or
      (($root.data? | type) == "object" and
        ([$root.data.code?, $root.data.errorCode?, $root.data.status?, $root.data.reason?] |
          any(.[]; auth_code)))
    ))
  ' >/dev/null 2>&1; then
    echo "MCP_AUTH_ERROR"
    return
  fi

  local SUCCESS_STATE
  SUCCESS_STATE=$(extract_success_state "$UNWRAPPED")

  # 2. MCP 服务不稳定（后端返回的服务异常）。已登记成功响应中的
  # 候选描述和示例不参与错误关键词分类。
  if [ "$SUCCESS_STATE" != "true" ] && echo "$UNWRAPPED" | grep -qiE "MCP.*服务.*不稳定|服务暂时不可用"; then
    echo "SERVICE_UNSTABLE"
    return
  fi

  # 3. MCP 调用失败（网络/连接错误）
  if [ "$SUCCESS_STATE" != "true" ] && echo "$UNWRAPPED" | grep -qiE "MCP 调用失败|connection refused|timeout|network[ _]error|网络连接失败"; then
    echo "MCP_SERVICE_ERROR"
    return
  fi

  # 4. 授权信息不匹配（MCC/产品/scope 未授权）
  if [ "$SUCCESS_STATE" != "true" ] && echo "$UNWRAPPED" | grep -qiE "mccCode.*is not auth|salesProductCodes.*is not auth|scope.*is not auth"; then
    echo "AUTH_MISMATCH"
    return
  fi

  if ! echo "$UNWRAPPED" | jq -e . >/dev/null 2>&1; then
    echo "CLI_ERROR:CLI 返回非 JSON 内容，原始输出已隐藏"
    return
  fi

  # 5. 通用业务错误（从解包后的 JSON 中提取 errorCode）
  local ERROR_CODE=$(extract_error_code "$UNWRAPPED")
  if [ -n "$ERROR_CODE" ] && [ "$ERROR_CODE" != "null" ]; then
    echo "ERROR:$ERROR_CODE"
    return
  fi

  # 6. CLI 命令本身的错误（success: false，从解包后的 JSON 提取）
  # 注意: MCP 业务响应可能嵌套在登记的 data/response 层。
  if [ "$SUCCESS_STATE" = "false" ]; then
    local ERROR_MSG=$(extract_error_message "$UNWRAPPED")
    echo "CLI_ERROR:$ERROR_MSG"
    return
  fi

  echo "SUCCESS"
}

extract_captured_json() {
  local RAW="$1"
  local ANALYSIS STATUS
  ANALYSIS=$(extract_unique_json "$RAW" 2>/dev/null || echo '{"status":"none"}')
  STATUS=$(echo "$ANALYSIS" | jq -r '.status // "none"' 2>/dev/null)
  [ "$STATUS" = "ok" ] || return 1
  echo "$ANALYSIS" | jq -ce '.value | select(type == "object")' 2>/dev/null
}

run_alipay_cli_json_capture() {
  local stderr_file stdout stderr_output combined_output

  ALIPAY_CLI_JSON_CAPTURE=""
  ALIPAY_CLI_JSON_EXIT_CODE=0
  stderr_file="$(mktemp "${TMPDIR:-/tmp}/alipay_cli_capture_stderr.XXXXXX")" || return 1
  stdout=$(PLATFORM="${DEV_TOOL_NAME:-unknown}" PLATFORM_ID="${PLATFORM_ID:-}" PRODUCT="${PRODUCT:-}" "$@" 2>"$stderr_file")
  ALIPAY_CLI_JSON_EXIT_CODE=$?
  stderr_output=$(cat "$stderr_file")
  rm -f "$stderr_file"

  combined_output=$(printf '%s\n%s' "$stdout" "$stderr_output")
  if type auth_has_local_state_permission_error >/dev/null 2>&1 &&
     auth_has_local_state_permission_error "$combined_output"; then
    ALIPAY_CLI_JSON_CAPTURE=""
    return "${AUTH_LOCAL_STATE_PERMISSION_EXIT_CODE:-77}"
  fi
  if ALIPAY_CLI_JSON_CAPTURE=$(extract_captured_json "$combined_output"); then
    return 0
  fi

  ALIPAY_CLI_JSON_CAPTURE=""
  return 1
}

confirm_logout_postcondition() {
  local logout_error_type whoami_error_type whoami_state
  local logout_result_state logout_capture_rc whoami_capture_rc attempt=1
  local max_attempts=3
  local interval_seconds=3

  ALIPAY_LOGOUT_POSTCONDITION=""
  ALIPAY_LOGOUT_ERROR_MESSAGE=""

  if [ "${ALIPAY_AIPAY_TEST_MODE:-0}" = "1" ]; then
    interval_seconds=0
  fi

  while [ "$attempt" -le "$max_attempts" ]; do
    logout_result_state="UNCONFIRMED"
    run_alipay_cli_json_capture alipay-cli logout --json
    logout_capture_rc=$?
    if [ "$logout_capture_rc" -eq 0 ]; then
      logout_error_type=$(detect_error "$ALIPAY_CLI_JSON_CAPTURE")
      if [ "$ALIPAY_CLI_JSON_EXIT_CODE" -eq 0 ] && [ "$logout_error_type" = "SUCCESS" ]; then
        ALIPAY_LOGOUT_POSTCONDITION="COMMAND_CONFIRMED_SUCCESS"
        return 0
      fi
      ALIPAY_LOGOUT_ERROR_MESSAGE=$(sanitize_customer_error_text "$(extract_error_message "$ALIPAY_CLI_JSON_CAPTURE")")
      case "$logout_error_type" in
        MCP_SERVICE_ERROR|SERVICE_UNSTABLE)
          logout_result_state="RETRYABLE"
          ;;
        SUCCESS)
          # A success payload paired with a non-zero exit code cannot prove the command result.
          logout_result_state="UNCONFIRMED"
          ;;
        *)
          logout_result_state="EXPLICIT_FAILURE"
          ;;
      esac
    elif [ "$logout_capture_rc" -eq "${AUTH_LOCAL_STATE_PERMISSION_EXIT_CODE:-77}" ]; then
      ALIPAY_LOGOUT_POSTCONDITION="LOCAL_FS_PERMISSION"
      return 1
    else
      ALIPAY_LOGOUT_ERROR_MESSAGE="退出命令未返回可唯一解析结果"
    fi

    run_alipay_cli_json_capture alipay-cli whoami --json
    whoami_capture_rc=$?
    if [ "$whoami_capture_rc" -eq "${AUTH_LOCAL_STATE_PERMISSION_EXIT_CODE:-77}" ]; then
      ALIPAY_LOGOUT_POSTCONDITION="LOCAL_FS_PERMISSION"
      return 1
    fi
    if [ "$whoami_capture_rc" -ne 0 ]; then
      ALIPAY_LOGOUT_POSTCONDITION="UNCONFIRMED"
      return 1
    fi

    whoami_error_type=$(detect_error "$ALIPAY_CLI_JSON_CAPTURE")
    if [ "$ALIPAY_CLI_JSON_EXIT_CODE" -ne 0 ] || [ "$whoami_error_type" != "SUCCESS" ]; then
      ALIPAY_LOGOUT_POSTCONDITION="UNCONFIRMED"
      return 1
    fi

    whoami_state=$(echo "$ALIPAY_CLI_JSON_CAPTURE" | jq -r '
      if (.data | type) != "object" then "UNCONFIRMED"
      elif (.data.logged_in? | type) == "boolean" and .data.logged_in == false then "LOGGED_OUT"
      elif (.data.is_expired? | type) == "boolean" and .data.is_expired == true then "LOGGED_OUT"
      elif (.data.logged_in? | type) == "boolean" and .data.logged_in == true and
           ((.data | has("is_expired") | not) or ((.data.is_expired? | type) == "boolean" and .data.is_expired == false)) then "STILL_LOGGED_IN"
      else "UNCONFIRMED"
      end
    ' 2>/dev/null)
    if [ "$whoami_state" = "LOGGED_OUT" ]; then
      ALIPAY_LOGOUT_POSTCONDITION="POSTCONDITION_LOGGED_OUT"
      return 0
    fi
    if [ "$whoami_state" != "STILL_LOGGED_IN" ] || [ "$logout_result_state" != "EXPLICIT_FAILURE" ]; then
      ALIPAY_LOGOUT_POSTCONDITION="UNCONFIRMED"
      return 1
    fi

    if [ "$attempt" -eq "$max_attempts" ]; then
      ALIPAY_LOGOUT_POSTCONDITION="STILL_LOGGED_IN"
      return 1
    fi
    sleep "$interval_seconds"
    attempt=$((attempt + 1))
  done
}

render_logout_unconfirmed() {
  render_error_message error.mcp.auth LOGOUT_UNCONFIRMED '{}'
}

render_logout_still_logged_in() {
  local message input
  message="${ALIPAY_LOGOUT_ERROR_MESSAGE:-退出命令未能使当前登录态失效}"
  input=$(jq -cn --arg errorMessage "$message" '{errorMessage:$errorMessage}')
  render_error_message error.mcp.auth LOGOUT_FAILED "$input"
}

# ─── MCP 认证错误处理 ──────────────────────────────────────────────────────
handle_mcp_auth_error() {
  if [ "${ALIPAY_AIPAY_SUPPRESS_AUTH_LOGOUT:-}" = "1" ]; then
    emit_control "AUTH_FLOW:AUTH_REQUIRED"
    return 1
  fi
  render_error_message error.mcp.auth START '{}' || {
    emit_control "AUTH_FLOW:FAILED"
    return 1
  }
  confirm_logout_postcondition
  case "$ALIPAY_LOGOUT_POSTCONDITION" in
    COMMAND_CONFIRMED_SUCCESS|POSTCONDITION_LOGGED_OUT)
      render_error_message error.mcp.auth LOGOUT_SUCCESS '{}' || {
        emit_control "AUTH_FLOW:FAILED"
        return 1
      }
      emit_control "AUTH_FLOW:AUTH_REQUIRED"
      ;;
    STILL_LOGGED_IN)
      render_logout_still_logged_in || {
        emit_control "AUTH_FLOW:FAILED"
        return 1
      }
      emit_control "AUTH_FLOW:LOGOUT_STILL_LOGGED_IN"
      ;;
    LOCAL_FS_PERMISSION)
      if type auth_local_state_permission_failure >/dev/null 2>&1; then
        auth_local_state_permission_failure
      else
        emit_control "AUTH_FLOW:RETRY_WITH_NETWORK"
      fi
      ;;
    *)
      render_logout_unconfirmed || {
        emit_control "AUTH_FLOW:FAILED"
        return 1
      }
      emit_control "AUTH_FLOW:RETRY_WITH_NETWORK"
      ;;
  esac
}

# ─── MCP 服务不可用处理 ────────────────────────────────────────────────────
handle_mcp_service_error() {
  local CLI_RESULT="$1"
  local UNWRAPPED=$(unwrap_mcp "$CLI_RESULT")

  if [ "${DEV_TOOL_NAME:-unknown}" != "unknown" ]; then
    render_error_message error.mcp.service AGENT_NETWORK '{}'
    return
  fi

  local SERVICE_ERROR_MSG
  SERVICE_ERROR_MSG=$(echo "$UNWRAPPED" | jq -r '.error.message // .errorMessage // .message // "未知错误"' 2>/dev/null) || SERVICE_ERROR_MSG="服务调用失败，原始输出已隐藏"
  SERVICE_ERROR_MSG=$(sanitize_customer_error_text "$SERVICE_ERROR_MSG")
  MESSAGE_INPUT=$(jq -cn --arg errorDetail "$SERVICE_ERROR_MSG" '{errorDetail:$errorDetail}')
  render_error_message error.mcp.service GENERIC "$MESSAGE_INPUT"
}

# ─── 授权信息不匹配处理 ────────────────────────────────────────────────────
handle_auth_mismatch() {
  local UNWRAPPED
  UNWRAPPED=$(unwrap_mcp "${1:-}")
  if echo "$UNWRAPPED" | grep -qiE "mccCode.*is not auth"; then
    emit_control "AUTH_FLOW:MCC_MISMATCH"
  else
    emit_control "AUTH_FLOW:SCOPE_MISMATCH"
  fi
}

# ─── 后端业务错误处理（完整透出错误信息） ──────────────────────────────────
handle_backend_error() {
  local CLI_RESULT="$1"
  local ERROR_CODE="$2"
  local UNWRAPPED=$(unwrap_mcp "$CLI_RESULT")

  # 提取错误信息
  local ERROR_MSG=$(extract_error_message "$UNWRAPPED")
  local BIZ_TIPS=$(extract_biz_tips "$UNWRAPPED")
  local ERROR_SCENE=$(extract_error_object_field "$UNWRAPPED" "errorScene")
  local ERROR_SPECIFIC=$(extract_error_object_field "$UNWRAPPED" "errorSpecific")

  ERROR_MSG=$(sanitize_customer_error_text "$ERROR_MSG")
  if [ -n "$ERROR_SCENE" ]; then ERROR_SCENE=$(sanitize_customer_error_text "$ERROR_SCENE"); fi
  if [ -n "$ERROR_SPECIFIC" ]; then ERROR_SPECIFIC=$(sanitize_customer_error_text "$ERROR_SPECIFIC"); fi

  # 透出 checkedError 中的详细错误描述（如 ar-sign.apply 返回的字段级校验错误）
  local CHECKED_ERRORS=$(extract_checked_errors "$UNWRAPPED")
  local CHECKED_ERRORS_JSON='[]'
  if [ -n "$CHECKED_ERRORS" ] && [ "$CHECKED_ERRORS" != "null" ] && [ "$CHECKED_ERRORS" != "[]" ]; then
    while IFS= read -r line; do
      if [ -n "$line" ]; then
        line=$(sanitize_customer_error_text "$line")
        CHECKED_ERRORS_JSON=$(jq -cn --argjson items "$CHECKED_ERRORS_JSON" --arg item "$line" '$items + [$item]')
      fi
    done < <(echo "$CHECKED_ERRORS" | jq -r '.[]? | .errorDesc // .message // . // empty' 2>/dev/null)
  fi

  if [ -n "$BIZ_TIPS" ] && [ "$BIZ_TIPS" != "null" ]; then
    BIZ_TIPS=$(sanitize_customer_error_text "$BIZ_TIPS")
  else
    BIZ_TIPS=""
  fi
  local APP_MAX="NO"
  if [ "$ERROR_CODE" = "APP_MAX_ERROR" ]; then
    APP_MAX="YES"
  fi
  MESSAGE_INPUT=$(jq -cn \
    --arg errorCode "$(sanitize_customer_error_text "$ERROR_CODE")" \
    --arg errorMessage "$ERROR_MSG" \
    --arg errorScene "$ERROR_SCENE" \
    --arg errorSpecific "$ERROR_SPECIFIC" \
    --argjson checkedErrors "$CHECKED_ERRORS_JSON" \
    --arg bizTips "$BIZ_TIPS" \
    --arg appMax "$APP_MAX" \
    '{errorCode:$errorCode,errorMessage:$errorMessage,errorScene:$errorScene,errorSpecific:$errorSpecific,checkedErrors:$checkedErrors,bizTips:$bizTips,appMax:$appMax}')
  render_error_message error.backend DEFAULT "$MESSAGE_INPUT"
}

# ─── MCP 服务不稳定处理 ────────────────────────────────────────────────────
handle_service_unstable() {
  render_error_message error.service.unstable DEFAULT '{}'
}

# ─── 统一错误处理入口 ──────────────────────────────────────────────────────
# 参数: $1 - CLI 执行结果文本（原始输出，含信封或不含）
#       $2 - 可选调用上下文，透传给 detect_error
# 返回: 0=成功, 1=当前动作失败（由主流程判断恢复、阻断或继续独立分支）
handle_error() {
  local CLI_RESULT="$1"
  local ERROR_CONTEXT="${2:-}"
  local ERROR_TYPE=$(detect_error "$CLI_RESULT" "$ERROR_CONTEXT")
  # 解包一次供 CLI_ERROR 分支使用（其他分支由各自的 handler 自己解包）
  local _UNWRAPPED=$(unwrap_mcp "$CLI_RESULT")

  case "$ERROR_TYPE" in
    "MCP_AUTH_ERROR")
      handle_mcp_auth_error
      ;;
    "MCP_SERVICE_ERROR")
      handle_mcp_service_error "$CLI_RESULT"
      ;;
    "AUTH_MISMATCH")
      handle_auth_mismatch "$CLI_RESULT"
      ;;
    "SERVICE_UNSTABLE")
      handle_service_unstable
      ;;
    "CLI_LOCAL_FS_PERMISSION")
      if type auth_local_state_permission_failure >/dev/null 2>&1; then
        auth_local_state_permission_failure
      else
        MESSAGE_INPUT=$(jq -cn \
          --arg errorMessage "alipay-cli 本地状态目录权限不足" \
          '{errorMessage:$errorMessage,bizTips:"",checkedErrors:[]}')
        render_error_message error.cli DEFAULT "$MESSAGE_INPUT"
      fi
      ;;
    "ERROR:"*)
      local CODE="${ERROR_TYPE#ERROR:}"
      handle_backend_error "$CLI_RESULT" "$CODE"
      ;;
    "CLI_ERROR:"*)
      local MSG="${ERROR_TYPE#CLI_ERROR:}"
      # CLI_ERROR 也透出 bizTips 和 checkedError（如果有的话）
      local CLI_BIZ_TIPS=$(extract_biz_tips "$_UNWRAPPED")
      if [ -n "$CLI_BIZ_TIPS" ] && [ "$CLI_BIZ_TIPS" != "null" ]; then
        CLI_BIZ_TIPS=$(sanitize_customer_error_text "$CLI_BIZ_TIPS")
      else
        CLI_BIZ_TIPS=""
      fi
      local CLI_CHECKED=$(extract_checked_errors "$_UNWRAPPED")
      local CLI_CHECKED_JSON='[]'
      if [ -n "$CLI_CHECKED" ] && [ "$CLI_CHECKED" != "null" ] && [ "$CLI_CHECKED" != "[]" ]; then
        while IFS= read -r line; do
          if [ -n "$line" ]; then
            line=$(sanitize_customer_error_text "$line")
            CLI_CHECKED_JSON=$(jq -cn --argjson items "$CLI_CHECKED_JSON" --arg item "$line" '$items + [$item]')
          fi
        done < <(echo "$CLI_CHECKED" | jq -r '.[]? | .errorDesc // .message // . // empty' 2>/dev/null)
      fi
      MESSAGE_INPUT=$(jq -cn \
        --arg errorMessage "$(sanitize_customer_error_text "$MSG")" \
        --arg bizTips "$CLI_BIZ_TIPS" \
        --argjson checkedErrors "$CLI_CHECKED_JSON" \
        '{errorMessage:$errorMessage,bizTips:$bizTips,checkedErrors:$checkedErrors}')
      render_error_message error.cli DEFAULT "$MESSAGE_INPUT"
      ;;
    "SUCCESS")
      return 0
      ;;
  esac

  return 1
}
