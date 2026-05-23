#!/bin/bash
# 查询已有应用并判断是否可复用
# 用法: source 此脚本前需设置 DEV_TOOL_NAME 环境变量
# 返回: 输出应用列表和复用判断结果

# 查询 WEBAPP 类型应用列表
RESULT=$(export PLATFORM=${DEV_TOOL_NAME} && alipay-cli mcp call apprelease.queryApplicationList \
  -d '{"request":{"appTypes":["WEBAPP"]}}' \
  --json 2>/dev/null)

# 检查返回是否成功
SUCCESS=$(echo "$RESULT" | jq -r '.success // false')

if [ "$SUCCESS" != "true" ]; then
  ERROR_MSG=$(echo "$RESULT" | jq -r '.error.message // "未知错误"')
  echo "❌ 查询应用列表失败: $ERROR_MSG"
  echo "FLOW:ERROR"
  exit 1
fi

# 安全提取应用列表
APP_LIST=$(echo "$RESULT" | jq -r '.resultObj.applicationList // []')
APP_COUNT=$(echo "$APP_LIST" | jq 'length')

if [ "$APP_COUNT" -eq 0 ]; then
  echo "📋 暂无应用，进入创建应用流程"
  echo "FLOW:CREATE_NEW"
else
  # 筛选 ON_LINE 状态的应用
  ONLINE_APPS=$(echo "$APP_LIST" | jq -r '[.[] | select(.status == "ONLINE")]')
  ONLINE_COUNT=$(echo "$ONLINE_APPS" | jq 'length')

  if [ "$ONLINE_COUNT" -eq 0 ]; then
    echo "📋 暂无上线应用，进入创建应用流程"
    echo "FLOW:CREATE_NEW"
  else
    # 输出上线应用列表
    echo "📋 发现您已有以下上线应用："
    echo ""
    echo "| 序号 | 应用ID | 应用名称 | 状态 |"
    echo "|------|--------|----------|------|"

    for i in $(seq 0 $((ONLINE_COUNT-1))); do
      APP=$(echo "$ONLINE_APPS" | jq ".[$i]")
      APP_ID=$(echo "$APP" | jq -r '.appId // "未知"')
      APP_NAME=$(echo "$APP" | jq -r '.appName // "未知"')
      echo "| $((i+1)) | $APP_ID | $APP_NAME | 已上线 |"
    done

    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "  请选择操作："
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    echo "  【复用】输入序号（1-$ONLINE_COUNT）→ 复用对应应用"
    echo "  【新建】输入 \"新建\" → 创建新应用"
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "FLOW:SELECT"
  fi
fi

# 复用应用：查询安全密钥并导出 alipayPublicKey
reuse_app() {
  local APP_ID="$1"

  RESULT=$(export PLATFORM=${DEV_TOOL_NAME} && alipay-cli mcp call apprelease.queryApplicationSecurityKey \
    -d "{\"request\":{\"appId\":\"${APP_ID}\"}}" \
    --json 2>/dev/null)

  if [ "$(echo "$RESULT" | jq -r '.success // false')" = "true" ]; then
    ALIPAY_PUBLIC_KEY=$(echo "$RESULT" | jq -r '.resultObj.securityKeys // [] | .[] | select(.signType == "RSA2") | .alipayPublicKey // empty' | head -1)

    if [ -n "$ALIPAY_PUBLIC_KEY" ]; then
      echo "$ALIPAY_PUBLIC_KEY" > ~/.config/${APP_ID}-alipayPublicKey.keytext
      echo "✅ 已获取支付宝公钥"
      echo "APP_ID=$APP_ID"
      echo "FLOW:REUSE_SUCCESS"
    else
      echo "⚠️ 未找到 RSA2 公钥，请先设置应用公钥"
      echo "FLOW:REUSE_NO_KEY"
    fi
  else
    ERROR_MSG=$(echo "$RESULT" | jq -r '.error.message // "未知错误"')
    echo "❌ 查询安全密钥失败: $ERROR_MSG"
    echo "FLOW:ERROR"
  fi
}