#!/bin/bash
# 授权范围不匹配处理
# 用途：当 MCP 调用返回授权范围不满足错误时，执行 logout + 重新授权
# 用法: source 此脚本前需设置 SALES_CODE, MCC_CODE, DEV_TOOL_NAME 环境变量

handle_scope_mismatch() {
  echo "⚠️ 授权范围不满足，正在退出登录..."

  # Step 1: 退出登录
  LOGOUT_RESULT=$(export PLATFORM=${DEV_TOOL_NAME} && alipay-cli logout --json 2>/dev/null)
  echo "📋 已退出当前登录"

  # Step 2: 根据 salesCode 构造正确的 scope
  case "$SALES_CODE" in
    "I1080300001000041203") SCOPE="app:all,fast_instant_trade_pay:write" ;;
    "I1080300001000160457") SCOPE="app:all,machine_pay:write,agmnt:write" ;;
    *) echo "❌ 未知产品码"; return 1 ;;
  esac

  # Step 3: 重新执行登录
  LOGIN_RESULT=$(export PLATFORM=${DEV_TOOL_NAME} && alipay-cli login --non-interactive --scope "$SCOPE" --json 2>&1)

  # Step 4: 解析 device_code
  DEVICE_CODE=$(echo "$LOGIN_RESULT" | jq -r '.data.data.device_code // empty')
  VERIFICATION_CODE=$(echo "$LOGIN_RESULT" | jq -r '.data.data.verification_code // empty')
  EXPIRES_IN=$(echo "$LOGIN_RESULT" | jq -r '.data.data.expires_in // 600')

  # Step 5: 三参数校验
  if [ -z "$DEVICE_CODE" ] || [ -z "$SALES_CODE" ] || [ -z "$MCC_CODE" ]; then
    echo "❌ 授权链接参数不完整，无法生成授权链接"
    echo "📋 deviceCode: ${DEVICE_CODE:-空}"
    echo "📋 productCode: ${SALES_CODE:-空}"
    echo "📋 mccCode: ${MCC_CODE:-空}"
    return 1
  fi

  # platform 可选，自动填充
  DEV_TOOL_NAME="${DEV_TOOL_NAME:-unknown}"

  # Step 6: 构造授权链接
  BROWSER_URL="https://aipay.alipay.com/cli-auth?deviceCode=${DEVICE_CODE}&productCode=${SALES_CODE}&mccCode=${MCC_CODE}&platform=${DEV_TOOL_NAME}"

  # 将有效期秒数转为可读格式
  if [ "$EXPIRES_IN" -ge 60 ] 2>/dev/null; then
    EXPIRES_MIN=$((EXPIRES_IN / 60))
    EXPIRES_DISPLAY="${EXPIRES_MIN} 分钟"
  else
    EXPIRES_DISPLAY="${EXPIRES_IN} 秒"
  fi

  echo "📋 请重新扫码授权，新的授权将包含正确的权限范围"
  echo ""
  echo "🌐 授权链接：[点击跳转进行授权]($BROWSER_URL)"
  echo "🔑 确认码：$VERIFICATION_CODE"
  echo "⏰ 有效期：$EXPIRES_DISPLAY"
}

# 检测授权范围不满足的错误关键词
check_scope_mismatch() {
  local RESULT="$1"
  if echo "$RESULT" | grep -qiE "mccCode.*is not auth|salesProductCodes.*is not auth|scope.*is not auth|授权信息不匹配|Authorization is empty|HTTP 401"; then
    return 0  # 匹配到授权范围不满足
  fi
  return 1  # 未匹配
}