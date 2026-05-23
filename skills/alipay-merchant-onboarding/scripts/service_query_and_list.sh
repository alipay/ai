#!/bin/bash
# 查询已有服务并按格式输出列表
# 用法: source 此脚本前需设置 DEV_TOOL_NAME 环境变量
# 返回: 输出服务列表和流程判断结果

# 查询已上线服务
RESULT=$(export PLATFORM=${DEV_TOOL_NAME} && alipay-cli mcp call a2a-pay-service.discoverBazaarServicesForMcp \
  -d '{"request":{"serviceStatus":"ACTIVE"}}' \
  --json 2>/dev/null)

# 解析服务列表
SERVICE_LIST=$(echo "$RESULT" | jq -r '.resultObj.serviceList // []')
SERVICE_COUNT=$(echo "$SERVICE_LIST" | jq 'length')

if [ "$SERVICE_COUNT" -eq 0 ] || [ "$SERVICE_LIST" = "[]" ] || [ -z "$SERVICE_LIST" ]; then
  echo "📋 暂无服务上架，需要创建新服务"
  echo "FLOW:CREATE_NEW"
else
  # 输出服务列表
  echo "📋 发现您已有以下服务："
  echo ""
  echo "| 序号 | 服务ID | 服务名称 | 描述 | 价格 | 状态 | 服务地址 |"
  echo "|------|--------|----------|------|------|------|----------|"

  for i in $(seq 0 $((SERVICE_COUNT-1))); do
    SERVICE=$(echo "$SERVICE_LIST" | jq ".[$i]")
    SERVICE_ID=$(echo "$SERVICE" | jq -r '.serviceId // "未知"')
    SERVICE_NAME=$(echo "$SERVICE" | jq -r '.serviceName // "未知"')
    SERVICE_DESC=$(echo "$SERVICE" | jq -r '.serviceDesc // "无描述"')
    PRICING=$(echo "$SERVICE" | jq -r '.pricing // "未知"')
    SERVICE_STATUS=$(echo "$SERVICE" | jq -r '.status // "未知"')
    RESOURCE_URL=$(echo "$SERVICE" | jq -r '.resourceUrl // "未知"')

    # 状态转换
    case "$SERVICE_STATUS" in
      "ONLINE") STATUS_CN="已上架" ;;
      "PENDING") STATUS_CN="审核中" ;;
      "REJECTED") STATUS_CN="审核拒绝" ;;
      *) STATUS_CN="$SERVICE_STATUS" ;;
    esac

    echo "| $((i+1)) | $SERVICE_ID | $SERVICE_NAME | $SERVICE_DESC | ${PRICING}元/次 | $STATUS_CN | $RESOURCE_URL |"
  done

  echo ""
  echo "请选择："
  echo "  • 输入序号（1-$SERVICE_COUNT）复用对应服务"
  echo "  • 输入\"新建\"创建新服务"
  echo "  • 输入\"修改\"修改已有服务"
  echo "FLOW:SELECT"
fi

# 校验服务数量限制
check_service_limit() {
  if [ "$SERVICE_COUNT" -ge 20 ]; then
    echo "❌ 已达到服务数量上限（20个），无法创建新服务"
    echo "📋 您当前已有 $SERVICE_COUNT 个服务，请选择复用已有服务或修改已有服务"
    return 1
  fi
  return 0
}