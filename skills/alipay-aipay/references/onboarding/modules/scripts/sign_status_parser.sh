#!/bin/bash

emit_signed_flow() {
  case "$1" in
    "I1080300001000041203") echo "FLOW:PC_WEB_SIGNED" ;;
    "I1080300001000041313") echo "FLOW:APP_SIGNED" ;;
    "I1080300001000160457") echo "FLOW:AI_PAY_SIGNED" ;;
    *) return 1 ;;
  esac
}

emit_sign_status_from_business() {
  local business="$1"
  local sales_code="$2"
  local ar_list ar_count has_effective has_submitted

  case "$sales_code" in
    "I1080300001000041203"|"I1080300001000041313"|"I1080300001000160457") ;;
    *) return 1 ;;
  esac

  ar_list=$(printf '%s' "$business" | jq -c '
    if (.resultObj | type) == "object" and (.resultObj.arInfoList | type) == "array" then
      .resultObj.arInfoList
    else
      null
    end
  ' 2>/dev/null) || return 1
  [ -n "$ar_list" ] && printf '%s' "$ar_list" | jq -e 'type == "array"' >/dev/null 2>&1 || return 1
  ar_count=$(printf '%s' "$ar_list" | jq 'length') || return 1

  if [ "$ar_count" -eq 0 ]; then
    echo "📋 签约状态: 未签约 (NOT_SIGNED)；进入 Step 4 签约材料类别"
    echo "SIGN_STATUS=NOT_SIGNED"
    case "$sales_code" in
      "I1080300001000041203") echo "FLOW:PC_WEB_NOT_SIGNED" ;;
      "I1080300001000041313") echo "FLOW:APP_NOT_SIGNED" ;;
      "I1080300001000160457") echo "FLOW:AI_PAY_NOT_SIGNED" ;;
    esac
    return 0
  fi

  has_effective=$(printf '%s' "$ar_list" | jq -r '[.[] | select(.arStatus == "02")] | length') || return 1
  has_submitted=$(printf '%s' "$ar_list" | jq -r '[.[] | select(.arStatus == "01")] | length') || return 1
  if [ "$has_effective" -gt 0 ]; then
    echo "✅ 签约已生效；无需签约材料，继续 Step 4 资源决策"
    echo "SIGN_STATUS=SIGNED_EFFECTIVE"
    emit_signed_flow "$sales_code"
  elif [ "$has_submitted" -gt 0 ]; then
    echo "📋 已提交签约（待生效），无需重复提交签约，继续推进后续步骤"
    echo "SIGN_STATUS=SIGN_SUBMITTED"
    emit_signed_flow "$sales_code"
  else
    echo "📋 其他签约状态；保留已取得的只读结果并将签约分支标记为待核验"
    echo "SIGN_STATUS=OTHER_STATUS"
    echo "FLOW:OTHER_STATUS"
  fi
}
