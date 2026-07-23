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
if [ -f "$COMMON_SCRIPT" ]; then
  # shellcheck source=/dev/null
  source "$COMMON_SCRIPT"
  init_dev_tool_name
else
  echo "❌ 缺少公共脚本: $COMMON_SCRIPT"
  return 1 2>/dev/null || exit 1
fi

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
  NORMALIZED=$(printf '%s' "$VALUE" | tr '\r\n\t' '   ' | awk '{$1=$1; print}')
  if [ -z "$NORMALIZED" ]; then
    echo "未知错误"
    return
  fi
  if printf '%s' "$NORMALIZED" | grep -qiE \
    'https?://|verification_url|device[_-]?code|authorization:[[:space:]]*bearer|payment-proof|-----BEGIN|private[_ -]?key|public[_ -]?key|access[_-]?token|(^|[^[:alnum:]_])token[=:]'; then
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
  TEXT=$(echo "$JSON" | jq -r 'if (.content | type == "array") and (.content[0].text != null) then .content[0].text else empty end' 2>/dev/null)
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
      .. | objects |
      select(
        ((.errorCode? | type) == "string" and .errorCode != "") or
        ((.errorCode? | type) == "object" and ((.errorCode.code? // "") != ""))
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
    if any(.. | objects; .success? == false) then "false"
    elif any(.. | objects; .success? == true) then "true"
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
# 返回: MCP_AUTH_ERROR | MCP_SERVICE_ERROR | AUTH_MISMATCH | SERVICE_UNSTABLE | ERROR:xxx | CLI_ERROR:xxx | SUCCESS
detect_error() {
  local CLI_RESULT="$1"

  # 空输入视为异常，不应被当作 SUCCESS
  if [ -z "$CLI_RESULT" ]; then
    echo "CLI_ERROR:CLI 返回为空"
    return
  fi

  # 先解包 MCP 信封，再进行错误检测
  local UNWRAPPED=$(unwrap_mcp "$CLI_RESULT")

  # 1. 优先检测 MCP 认证错误（HTTP 401）
  if echo "$UNWRAPPED" | grep -qiE "HTTP 401|Authorization is empty|非法的认证信息"; then
    echo "MCP_AUTH_ERROR"
    return
  fi

  # 2. MCP 服务不稳定（后端返回的服务异常）
  if echo "$UNWRAPPED" | grep -qiE "MCP.*服务.*不稳定|服务暂时不可用"; then
    echo "SERVICE_UNSTABLE"
    return
  fi

  # 3. MCP 调用失败（网络/连接错误）
  if echo "$UNWRAPPED" | grep -qiE "MCP 调用失败|connection refused|timeout|network error"; then
    echo "MCP_SERVICE_ERROR"
    return
  fi

  # 4. 授权信息不匹配（MCC/产品/scope 未授权）
  if echo "$UNWRAPPED" | grep -qiE "mccCode.*is not auth|salesProductCodes.*is not auth|scope.*is not auth"; then
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
  # 注意: MCP 业务响应可能嵌套在 data/response 下，因此递归检测 success=false。
  local SUCCESS=$(extract_success_state "$UNWRAPPED")
  if [ "$SUCCESS" = "false" ]; then
    local ERROR_MSG=$(extract_error_message "$UNWRAPPED")
    echo "CLI_ERROR:$ERROR_MSG"
    return
  fi

  echo "SUCCESS"
}

# ─── MCP 认证错误处理 ──────────────────────────────────────────────────────
handle_mcp_auth_error() {
  local LOGOUT_RESULT LOGOUT_EXIT_CODE LOGOUT_ERROR_TYPE LOGOUT_ERROR_MSG
  local LOGOUT_ANALYSIS LOGOUT_PARSE_STATUS

  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "🔐 未登录或授权已过期"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
  echo "❌ 当前登录状态已失效，无法继续操作"
  echo ""
  echo "📋 原因：MCP 调用返回认证错误（HTTP 401）"
  echo "📋 说明：Authorization is empty（认证信息为空）"
  echo ""
  echo "🔄 正在退出当前登录..."
  LOGOUT_RESULT=$(PLATFORM=${DEV_TOOL_NAME:-unknown} alipay-cli logout --json 2>&1)
  LOGOUT_EXIT_CODE=$?
  LOGOUT_ERROR_TYPE=$(detect_error "$LOGOUT_RESULT")
  LOGOUT_ANALYSIS=$(extract_unique_json "$LOGOUT_RESULT" 2>/dev/null || echo '{"status":"none"}')
  LOGOUT_PARSE_STATUS=$(echo "$LOGOUT_ANALYSIS" | jq -r '.status // "none"' 2>/dev/null)

  if [ "$LOGOUT_EXIT_CODE" -ne 0 ] || [ "$LOGOUT_ERROR_TYPE" != "SUCCESS" ]; then
    echo ""
    if [ "$LOGOUT_PARSE_STATUS" != "ok" ] || [ "$LOGOUT_ERROR_TYPE" = "MCP_SERVICE_ERROR" ] || [ "$LOGOUT_ERROR_TYPE" = "SERVICE_UNSTABLE" ]; then
      echo "❌ 无法确认退出当前登录结果，已停止重新授权"
      echo "📋 这通常表示当前 Agent 执行环境缺少联网权限、CLI wrapper 混入输出，或 stdout/stderr 无法唯一解析。"
      echo "📋 这不代表用户本机 logout 失败，也不能据此判断支付宝业务失败。"
      echo "📋 Agent 应申请可联网权限后重试同一动作；不要要求用户手动 logout 代替本轮事实。"
      echo "📋 请授权 Agent 联网重试当前动作；确认脚本实际退出成功后再重新授权。"
    else
      echo "❌ 退出当前登录失败，已停止重新授权"
      LOGOUT_ERROR_MSG=$(sanitize_customer_error_text "$(extract_error_message "$LOGOUT_RESULT")")
      echo "📋 错误信息：$LOGOUT_ERROR_MSG"
      echo "📋 请先重试退出登录；确认退出成功后再重新授权。"
    fi
    return 1
  fi

  echo ""
  echo "✅ 已退出登录状态"
  echo ""
  echo "📌 请重新执行登录授权流程："
  echo "   1. 我会生成授权链接"
  echo "   2. 您使用支付宝扫码授权"
  echo "   3. 授权成功后继续当前操作"
  echo ""
  echo "📌 产品、MCC 和授权范围未变化时，沿用已有确认立即重新生成授权链接；发生变化时先重新确认受影响内容。"
}

# ─── MCP 服务不可用处理 ────────────────────────────────────────────────────
handle_mcp_service_error() {
  local CLI_RESULT="$1"
  local UNWRAPPED=$(unwrap_mcp "$CLI_RESULT")

  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "⚠️  MCP 服务暂时不可用"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
  if [ "${DEV_TOOL_NAME:-unknown}" != "unknown" ]; then
    echo "❌ 当前命令需要访问支付宝服务，但当前 Agent 执行环境可能没有外网权限"
    echo ""
    echo "📋 处理方式："
    echo "  - Agent 应申请可联网权限后重试同一条命令"
    echo "  - 不要要求用户排查本机网络，也不要更换业务参数"
    echo ""
    echo "请授权 Agent 联网重试，或稍后重新执行当前命令。"
    return
  fi

  echo "❌ 无法连接到支付宝服务，请稍后重试"
  echo ""
  echo "📋 错误详情："
  local SERVICE_ERROR_MSG
  SERVICE_ERROR_MSG=$(echo "$UNWRAPPED" | jq -r '.error.message // .errorMessage // .message // "未知错误"' 2>/dev/null) || SERVICE_ERROR_MSG="服务调用失败，原始输出已隐藏"
  sanitize_customer_error_text "$SERVICE_ERROR_MSG"
  echo ""
  echo "📋 当前动作已停止重试；由主流程记录受影响分支，并在不受其依赖的情况下继续其他分支。"
  echo "📋 本轮收口时将一次说明未恢复的动作、受影响分支和后续恢复方式。"
}

# ─── 授权信息不匹配处理 ────────────────────────────────────────────────────
handle_auth_mismatch() {
  echo "📋 当前授权范围或经营类目不匹配，需要退出当前登录并重新生成授权页面。"
}

# ─── 后端业务错误处理（完整透出错误信息） ──────────────────────────────────
handle_backend_error() {
  local CLI_RESULT="$1"
  local ERROR_CODE="$2"
  local UNWRAPPED=$(unwrap_mcp "$CLI_RESULT")

  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "❌ 业务处理失败"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
  echo "📋 错误码：$ERROR_CODE"

  # 提取错误信息
  local ERROR_MSG=$(extract_error_message "$UNWRAPPED")
  local BIZ_TIPS=$(extract_biz_tips "$UNWRAPPED")
  local ERROR_SCENE=$(extract_error_object_field "$UNWRAPPED" "errorScene")
  local ERROR_SPECIFIC=$(extract_error_object_field "$UNWRAPPED" "errorSpecific")

  ERROR_MSG=$(sanitize_customer_error_text "$ERROR_MSG")
  echo "📋 错误信息：$ERROR_MSG"

  if [ -n "$ERROR_SCENE" ] || [ -n "$ERROR_SPECIFIC" ]; then
    ERROR_SCENE=$(sanitize_customer_error_text "${ERROR_SCENE:-未知}")
    ERROR_SPECIFIC=$(sanitize_customer_error_text "${ERROR_SPECIFIC:-未知}")
    echo "📋 错误场景：$ERROR_SCENE / $ERROR_SPECIFIC"
  fi

  # 透出 checkedError 中的详细错误描述（如 ar-sign.apply 返回的字段级校验错误）
  local CHECKED_ERRORS=$(extract_checked_errors "$UNWRAPPED")
  if [ -n "$CHECKED_ERRORS" ] && [ "$CHECKED_ERRORS" != "null" ] && [ "$CHECKED_ERRORS" != "[]" ]; then
    echo ""
    echo "📋 详细校验错误："
    echo "$CHECKED_ERRORS" | jq -r '.[]? | .errorDesc // .message // . // empty' 2>/dev/null | while IFS= read -r line; do
      [ -n "$line" ] && echo "  - $(sanitize_customer_error_text "$line")"
    done
  fi

  if [ -n "$BIZ_TIPS" ] && [ "$BIZ_TIPS" != "null" ] && [ "$BIZ_TIPS" != "" ]; then
    echo ""
    echo "💡 提示：$(sanitize_customer_error_text "$BIZ_TIPS")"
  fi

  if [ "$ERROR_CODE" = "APP_MAX_ERROR" ]; then
    echo ""
    echo "📌 处理建议：当前主体下应用数量已达到上限，无法继续新建应用。请优先复用已有上线应用；如必须新建，请前往支付宝开放平台处理应用配额或联系支付宝技术支持。"
  fi

  echo ""
  echo "📋 当前业务错误不会自动重试；请先按以上错误信息修正受影响分支的业务条件。"
  echo "如需帮助，请联系技术支持并提供以上脱敏错误信息。"
}

# ─── MCP 服务不稳定处理 ────────────────────────────────────────────────────
handle_service_unstable() {
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "⚠️  MCP 服务暂时不稳定"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
  echo "当前动作已停止重试；由主流程记录受影响分支，并在不受其依赖的情况下继续其他分支。"
  echo "本轮收口时将一次说明未恢复的动作、受影响分支和后续恢复方式。"
}

# ─── 统一错误处理入口 ──────────────────────────────────────────────────────
# 参数: $1 - CLI 执行结果文本（原始输出，含信封或不含）
# 返回: 0=成功, 1=当前动作失败（由主流程判断恢复、阻断或继续独立分支）
handle_error() {
  local CLI_RESULT="$1"
  local ERROR_TYPE=$(detect_error "$CLI_RESULT")
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
    "ERROR:"*)
      local CODE="${ERROR_TYPE#ERROR:}"
      handle_backend_error "$CLI_RESULT" "$CODE"
      ;;
    "CLI_ERROR:"*)
      local MSG="${ERROR_TYPE#CLI_ERROR:}"
      echo "❌ 命令执行失败：$(sanitize_customer_error_text "$MSG")"
      # CLI_ERROR 也透出 bizTips 和 checkedError（如果有的话）
      local CLI_BIZ_TIPS=$(extract_biz_tips "$_UNWRAPPED")
      if [ -n "$CLI_BIZ_TIPS" ] && [ "$CLI_BIZ_TIPS" != "null" ] && [ "$CLI_BIZ_TIPS" != "" ]; then
        echo "💡 $(sanitize_customer_error_text "$CLI_BIZ_TIPS")"
      fi
      local CLI_CHECKED=$(extract_checked_errors "$_UNWRAPPED")
      if [ -n "$CLI_CHECKED" ] && [ "$CLI_CHECKED" != "null" ] && [ "$CLI_CHECKED" != "[]" ]; then
        echo "📋 详细校验错误："
        echo "$CLI_CHECKED" | jq -r '.[]? | .errorDesc // .message // . // empty' 2>/dev/null | while IFS= read -r line; do
          [ -n "$line" ] && echo "  - $(sanitize_customer_error_text "$line")"
        done
      fi
      ;;
    "SUCCESS")
      return 0
      ;;
  esac

  return 1
}
