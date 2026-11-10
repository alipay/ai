#!/bin/bash
#=============================================================================
# 脚本名称: ar_sign_apply.sh
# 功能描述: 提交产品签约申请，支持AI 按量付费、AI 网页应用收款、AI 移动应用收款三种模式
# 调用位置: Step 5.1 产品签约
# 调用前置: 脚本通过 error_handler.sh 间接初始化 DEV_TOOL_NAME/PLATFORM_ID；需传入 --sales-code 和 --mcc-code，或兼容使用同名环境变量
# 用法:
#   AI 按量付费: bash ar_sign_apply.sh --product aipay --sales-code <code> --mcc-code <code> --mcc-context-receipt <receipt> [--special-qualification-group-index <1-based> --special-license-json <json>]
#   AI 网页应用收款: bash ar_sign_apply.sh --product webpay --sales-code <code> --mcc-code <code> --mcc-context-receipt <receipt> --picurl1 <imageRef1> --picurl2 <imageRef2> --picurl3 <imageRef3> [--special-qualification-group-index <1-based> --special-license-json <json>]
#   AI 移动应用收款: bash ar_sign_apply.sh --product apppay --sales-code <code> --mcc-code <code> --mcc-context-receipt <receipt> --app-name <name> --picurl1 <imageRef1> --picurl2 <imageRef2> --picurl3 <imageRef3> [--special-qualification-group-index <1-based> --special-license-json <json>]
# 返回值:
#   成功: FLOW:AI_PAY_SIGN_CONTINUE | FLOW:PC_WEB_SIGN_CONTINUE | FLOW:APP_SIGN_CONTINUE
#   失败: exit 1（由 handle_error 输出详细错误信息）
#=============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# 一次性 source error_handler（含 unwrap_mcp）
if [ -f "${SCRIPT_DIR}/error_handler.sh" ]; then
  source "${SCRIPT_DIR}/error_handler.sh"
else
  echo "❌ 缺少错误处理脚本: ${SCRIPT_DIR}/error_handler.sh"
  exit 1
fi
source "${SCRIPT_DIR}/network_retry.sh"

require_command jq || exit 1
require_command alipay-cli || exit 1

if ! command -v python3 >/dev/null 2>&1 && ! command -v uuidgen >/dev/null 2>&1; then
  echo "❌ 缺少依赖命令: python3 或 uuidgen"
  exit 1
fi

# 生成 UUID 作为 bizRequestNo
BIZ_REQUEST_NO=$(python3 -c "import uuid; print(uuid.uuid4())" 2>/dev/null || uuidgen | tr '[:upper:]' '[:lower:]')

# 优先使用 --product 参数，未传时从环境变量继承
PRODUCT_TYPE="${PRODUCT_TYPE:-}"
PICURL1=""
PICURL2=""
PICURL3=""
APP_NAME=""
MCC_CONTEXT_RECEIPT=""
SPECIAL_QUALIFICATION_GROUP_INDEX=""
SPECIAL_LICENSE_JSON='[]'

# 解析参数
while [[ $# -gt 0 ]]; do
  case $1 in
    --product)
      [ $# -ge 2 ] || { echo "❌ 缺少参数值: $1"; exit 1; }
      PRODUCT_TYPE="$2"; shift 2 ;;
    --sales-code)
      [ $# -ge 2 ] || { echo "❌ 缺少参数值: $1"; exit 1; }
      SALES_CODE="$2"; shift 2 ;;
    --mcc-code)
      [ $# -ge 2 ] || { echo "❌ 缺少参数值: $1"; exit 1; }
      MCC_CODE="$2"; shift 2 ;;
    --mcc-context-receipt)
      [ $# -ge 2 ] || { echo "❌ 缺少参数值: $1"; exit 1; }
      MCC_CONTEXT_RECEIPT="$2"; shift 2 ;;
    --special-qualification-group-index)
      [ $# -ge 2 ] || { echo "❌ 缺少参数值: $1"; exit 1; }
      SPECIAL_QUALIFICATION_GROUP_INDEX="$2"; shift 2 ;;
    --picurl1)
      [ $# -ge 2 ] || { echo "❌ 缺少参数值: $1"; exit 1; }
      PICURL1="$2"; shift 2 ;;
    --picurl2)
      [ $# -ge 2 ] || { echo "❌ 缺少参数值: $1"; exit 1; }
      PICURL2="$2"; shift 2 ;;
    --picurl3)
      [ $# -ge 2 ] || { echo "❌ 缺少参数值: $1"; exit 1; }
      PICURL3="$2"; shift 2 ;;
    --app-name)
      [ $# -ge 2 ] || { echo "❌ 缺少参数值: $1"; exit 1; }
      APP_NAME="$2"; shift 2 ;;
    --special-license-json)
      [ $# -ge 2 ] || { echo "❌ 缺少参数值: $1"; exit 1; }
      SPECIAL_LICENSE_JSON="$2"; shift 2 ;;
    *)
      echo "❌ 未知参数: $1"; exit 1 ;;
  esac
done

if [ -z "$SALES_CODE" ] || [ -z "$MCC_CODE" ]; then
  echo "❌ 缺少必需参数（请传入 --sales-code 和 --mcc-code，或设置 SALES_CODE/MCC_CODE 环境变量）"
  exit 1
fi
if [ -z "$MCC_CONTEXT_RECEIPT" ]; then
  echo "❌ 签约提交必须绑定本轮 MCC_CONTEXT_RECEIPT"
  exit 1
fi
if [ -n "$SPECIAL_QUALIFICATION_GROUP_INDEX" ] && ! [[ "$SPECIAL_QUALIFICATION_GROUP_INDEX" =~ ^[1-9][0-9]*$ ]]; then
  echo "❌ 特殊资质组合序号必须是从 1 开始的整数"
  exit 1
fi

if [ -n "$PRODUCT_TYPE" ] && [ "$PRODUCT_TYPE" != "aipay" ] && [ "$PRODUCT_TYPE" != "webpay" ] && [ "$PRODUCT_TYPE" != "apppay" ]; then
  echo "❌ --product 参数值无效: ${PRODUCT_TYPE}（仅支持 aipay|webpay|apppay）"
  exit 1
fi

case "$SALES_CODE" in
  "I1080300001000160457")
    EXPECTED_PRODUCT_TYPE="aipay"
    ;;
  "I1080300001000041203")
    EXPECTED_PRODUCT_TYPE="webpay"
    ;;
  "I1080300001000041313")
    EXPECTED_PRODUCT_TYPE="apppay"
    ;;
  *)
    echo "❌ 未知 SALES_CODE: $SALES_CODE"
    exit 1
    ;;
esac

if [ -n "$PRODUCT_TYPE" ] && [ "$PRODUCT_TYPE" != "$EXPECTED_PRODUCT_TYPE" ]; then
  echo "❌ --product 与 SALES_CODE 不匹配：--product=${PRODUCT_TYPE}, SALES_CODE=${SALES_CODE}"
  echo "📋 期望 --product=${EXPECTED_PRODUCT_TYPE}"
  exit 1
fi

PRODUCT_TYPE="${PRODUCT_TYPE:-$EXPECTED_PRODUCT_TYPE}"
init_alipay_cli_product "$PRODUCT_TYPE" || exit 1

if [ -z "$BIZ_REQUEST_NO" ]; then
  echo "❌ 无法生成 bizRequestNo"
  exit 1
fi

if ! printf '%s' "$SPECIAL_LICENSE_JSON" | jq -e '
  def safe_text:
    type == "string" and length > 0 and all(explode[]; . >= 32 and . != 127);
  type == "array" and
  all(.[]; (type == "object") and
    (.licenseType | safe_text) and
    (.licensePic | safe_text) and
    ((keys - ["licenseType","licensePic"]) | length == 0)
  )
' >/dev/null 2>&1; then
  echo "❌ 特殊资质 specialLicense 必须是 [{licenseType, licensePic}] 数组，licensePic 使用上传返回的图片引用值"
  exit 1
fi

SPECIAL_CONTEXT_JSON=$(jq -cn \
  --arg productType "$PRODUCT_TYPE" \
  --arg salesCode "$SALES_CODE" \
  --arg mccCode "$MCC_CODE" \
  --arg mccContextReceipt "$MCC_CONTEXT_RECEIPT" \
  --arg qualificationGroupIndex "$SPECIAL_QUALIFICATION_GROUP_INDEX" \
  --argjson specialLicense "$SPECIAL_LICENSE_JSON" \
  '{
    productType: $productType,
    salesCode: $salesCode,
    mccCode: $mccCode,
    mccContextReceipt: $mccContextReceipt,
    qualificationGroupIndex: $qualificationGroupIndex,
    specialLicense: $specialLicense
  }') || exit 1
if ! printf '%s' "$SPECIAL_CONTEXT_JSON" | node "$ERROR_RENDERER" --validate-signing-special-license-context >/dev/null 2>&1; then
  echo "❌ 特殊资质与本轮 MCC 上下文或所选资质组合不一致，已停止签约提交"
  exit 1
fi

# 场景判断（精确比较而非子串匹配）
if [ "$SALES_CODE" = "I1080300001000160457" ]; then
  # ============ AI 按量付费签约 JSON（无截图） ============
  REQUEST_JSON=$(jq -n \
    --arg bizRequestNo "$BIZ_REQUEST_NO" \
    --arg mccCode "$MCC_CODE" \
    --arg salesCode "$SALES_CODE" \
    --argjson specialLicense "$SPECIAL_LICENSE_JSON" \
    '{
      request: {
        bizFeatures: {},
        bizRequestNo: $bizRequestNo,
        businessProperty: ({mccCode: $mccCode} + (if ($specialLicense | length) > 0 then {specialLicense: $specialLicense} else {} end)),
        channelCode: "B_SK_SH_RPC",
        extension: {},
        orderType: "NEW_SIGN",
        salesProductCodes: [$salesCode]
      },
      ctx: {}
    }')

elif [ "$SALES_CODE" = "I1080300001000041203" ]; then
  # ============ AI 网页应用收款签约 JSON（有截图） ============
  if [ -z "$PICURL1" ] || [ -z "$PICURL2" ] || [ -z "$PICURL3" ]; then
    echo "❌ AI 网页应用收款需要 3 个上传后的图片引用值"
    exit 1
  fi

  REQUEST_JSON=$(jq -n \
    --arg bizRequestNo "$BIZ_REQUEST_NO" \
    --arg mccCode "$MCC_CODE" \
    --arg salesCode "$SALES_CODE" \
    --arg picUrl1 "$PICURL1" \
    --arg picUrl2 "$PICURL2" \
    --arg picUrl3 "$PICURL3" \
    --argjson specialLicense "$SPECIAL_LICENSE_JSON" \
    '{
      request: {
        bizFeatures: {},
        bizRequestNo: $bizRequestNo,
        businessProperty: ({mccCode: $mccCode} + (if ($specialLicense | length) > 0 then {specialLicense: $specialLicense} else {} end) + {
          webAppDTO: {
            placeType: "ONLINE_WEBAPP",
            appType: "PC_WEB",
            appStatus: "OFFLINE",
            screenshot: [$picUrl1, $picUrl2, $picUrl3]
          }
        }),
        channelCode: "B_SK_SH_RPC",
        extension: {},
        orderType: "NEW_SIGN",
        salesProductCodes: [$salesCode]
      },
      ctx: {}
    }')

elif [ "$SALES_CODE" = "I1080300001000041313" ]; then
  # ============ AI 移动应用收款签约 JSON（有 APP 名称和截图） ============
  if [ -z "$PICURL1" ] || [ -z "$PICURL2" ] || [ -z "$PICURL3" ]; then
    echo "❌ AI 移动应用收款需要 3 个上传后的图片引用值"
    exit 1
  fi
  if [ -z "$APP_NAME" ]; then
    echo "❌ AI 移动应用收款需要 --app-name"
    exit 1
  fi

  REQUEST_JSON=$(jq -n \
    --arg bizRequestNo "$BIZ_REQUEST_NO" \
    --arg mccCode "$MCC_CODE" \
    --arg salesCode "$SALES_CODE" \
    --arg appName "$APP_NAME" \
    --arg picUrl1 "$PICURL1" \
    --arg picUrl2 "$PICURL2" \
    --arg picUrl3 "$PICURL3" \
    --argjson specialLicense "$SPECIAL_LICENSE_JSON" \
    '{
      request: {
        bizFeatures: {},
        bizRequestNo: $bizRequestNo,
        businessProperty: ({mccCode: $mccCode} + (if ($specialLicense | length) > 0 then {specialLicense: $specialLicense} else {} end) + {
          nativeAppDTO: {
            placeType: "ONLINE_NATIVEYAPP",
            name: $appName,
            appStatus: "OFFLINE",
            screenshot: [$picUrl1, $picUrl2, $picUrl3]
          }
        }),
        channelCode: "B_SK_SH_RPC",
        extension: {},
        orderType: "NEW_SIGN",
        salesProductCodes: [$salesCode]
      },
      ctx: {}
    }')

else
  echo "❌ 未知 SALES_CODE: $SALES_CODE"
  exit 1
fi

require_alipay_cli_local_state_access_or_emit || exit "$?"
export PLATFORM="${DEV_TOOL_NAME}" PLATFORM_ID="${PLATFORM_ID:-}"
run_network_retry RESULT write sign_apply -- alipay-cli mcp call ar-sign.apply \
  -d "$REQUEST_JSON" --json
RETRY_RC=$?
if [ "$RETRY_RC" -eq 75 ]; then
  RECONCILE_OUTPUT=$(ALIPAY_AIPAY_SUPPRESS_LOCAL_FS_RETRY_MARKER=1 bash "${SCRIPT_DIR}/query_sign_status.sh" --sales-code "$SALES_CODE" --product-type "$PRODUCT_TYPE" 2>&1 || true)
  RECONCILED_STATUS=$(printf '%s\n' "$RECONCILE_OUTPUT" | sed -n 's/^ALIPAY_AIPAY_INTERNAL:SIGN_STATUS=//p' | tail -1)
if [ "$RECONCILED_STATUS" = "SIGN_SUBMITTED" ] || [ "$RECONCILED_STATUS" = "SIGNED_EFFECTIVE" ]; then
    emit_control "SIGN_APPLY_RESULT=SUCCESS"
    emit_stage_metric "onboarding.confirm_signing"
    case "$PRODUCT_TYPE" in
      aipay) emit_control "FLOW:AI_PAY_SIGN_CONTINUE" ;;
      webpay) emit_control "FLOW:PC_WEB_SIGN_CONTINUE" ;;
      apppay) emit_control "FLOW:APP_SIGN_CONTINUE" ;;
    esac
    exit 0
  fi
  echo "❌ 签约提交响应不明且现有查询无法排除传播延迟，结果标记为 UNKNOWN，禁止自动重复提交"
  emit_control "SIGN_APPLY_RESULT=UNKNOWN"
  exit 1
elif [ "$RETRY_RC" -eq "${ALIPAY_CLI_LOCAL_STATE_PERMISSION_EXIT_CODE:-77}" ]; then
  exit "$RETRY_RC"
elif [ "$RETRY_RC" -ne 0 ]; then
  echo "❌ 签约提交因明确未发送的网络异常在自动重试两次后仍未恢复"
  emit_control "SIGN_APPLY_RESULT=FAILED"
  exit 1
fi

# 错误检测（先于业务解析，handle_error 内部会自动解包信封）
if ! handle_error "$RESULT" "MCP_AUTHENTICATED_CALL"; then
  emit_control "SIGN_APPLY_RESULT=FAILED"
  exit 1
fi

# 解包 MCP 信封后解析业务字段
BUSINESS=$(unwrap_mcp "$RESULT")
SUCCESS=$(echo "$BUSINESS" | jq -r '.success // false')

if [ "$SUCCESS" = "true" ]; then
  emit_control "✅ 签约提交成功"
  emit_control "SIGN_APPLY_STATUS=SUBMITTED"
  emit_control "SIGN_APPLY_RESULT=SUCCESS"
  emit_stage_metric "onboarding.confirm_signing"
  # 签约提交成功后无需等待审核，立即推进后续步骤
  # AI 按量付费: 继续 5.2 服务注册 → 5.3 应用发布
  # AI 网页应用收款/AI 移动应用收款: 继续 5.3 应用发布
  if [ "$SALES_CODE" = "I1080300001000160457" ]; then
    emit_control "FLOW:AI_PAY_SIGN_CONTINUE"
  elif [ "$SALES_CODE" = "I1080300001000041313" ]; then
    emit_control "FLOW:APP_SIGN_CONTINUE"
  else
    emit_control "FLOW:PC_WEB_SIGN_CONTINUE"
  fi
else
  # handle_error 已处理 ERROR/CLI_ERROR 路径并透出详细错误信息
  # 此处为防御性兜底：handle_error 返回成功但 success 非 true 的极端场景
  ERROR_MSG=$(echo "$BUSINESS" | jq -r '.error.message // .errorMessage // "未知错误"')
  ERROR_MSG=$(sanitize_customer_error_text "$ERROR_MSG")
  echo "❌ 签约提交失败: $ERROR_MSG"
  emit_control "SIGN_APPLY_RESULT=FAILED"
  exit 1
fi
