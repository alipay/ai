#!/bin/bash
# 查询签约状态并根据结果判断后续流程
# 用法: source 此脚本前需设置 SALES_CODE 环境变量
# 返回: 输出签约状态判断结果和处理建议

# 查询签约状态
RESULT=$(export PLATFORM=${DEV_TOOL_NAME} && alipay-cli mcp call ar-query.queryArInfosBySalesProd \
  -d "{\"request\":{\"salesProductCodes\":[\"${SALES_CODE}\"]},\"ctx\":{}}" \
  --json 2>/dev/null)

# 使用 // [] 安全提取数组，判断签约状态
AR_COUNT=$(echo "$RESULT" | jq '.resultObj.arInfoList // [] | length')

if [ "$AR_COUNT" -eq 0 ]; then
  echo "📋 未签约 (NOT_SIGNED)，进入资料采集流程"

  # 根据产品类型判断后续流程
  if [ "$SALES_CODE" = "I1080300001000041203" ]; then
    echo "FLOW:PC_WEB_NOT_SIGNED"
    # 电脑网站支付未签约：需先采集 3 张网站截图，再进入 Step 5 签约
  else
    echo "FLOW:AI_PAY_NOT_SIGNED"
    # AI收未签约：直接进入 Step 5（签约 + 服务注册 + 应用发布），无需前置资料采集
  fi
else
  # 使用 // [] 避免迭代 null 报错
  HAS_EFFECTIVE=$(echo "$RESULT" | jq -r '[.resultObj.arInfoList // [] | .[] | select(.arStatus == "02")] | length')
  HAS_SUBMITTED=$(echo "$RESULT" | jq -r '[.resultObj.arInfoList // [] | .[] | select(.arStatus == "01")] | length')

  if [ "$HAS_EFFECTIVE" -gt 0 ] || [ "$HAS_SUBMITTED" -gt 0 ]; then
    echo "✅ 已签约/已提交签约，跳过资料采集"

    if [ "$SALES_CODE" = "I1080300001000041203" ]; then
      echo "FLOW:PC_WEB_SIGNED"
      # 电脑网站支付已签约：直接进入 Step 5（仅应用发布）
    else
      echo "FLOW:AI_PAY_SIGNED"
      # AI收已签约：直接进入 Step 5（服务注册 + 应用发布）
    fi
  else
    echo "📋 其他签约状态，进入资料采集流程"
    echo "FLOW:OTHER_STATUS"
  fi
fi