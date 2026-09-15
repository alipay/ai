#!/bin/bash
#=============================================================================
# 脚本名称: upload_special_license.sh
# 功能描述: 上传特殊资质材料并生成 ar-sign.apply 的 specialLicense 数组
# 调用位置: Step 4 签约材料类别
# 用法:
#   bash upload_special_license.sh --product-type <aipay|webpay|apppay> --mcc-context-receipt <receipt> --qualification-group-index <1-based> --file <localFile> [--file <localFile> ...]
#=============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ -f "${SCRIPT_DIR}/error_handler.sh" ]; then
  # shellcheck source=/dev/null
  source "${SCRIPT_DIR}/error_handler.sh"
else
  echo "❌ 缺少错误处理脚本: ${SCRIPT_DIR}/error_handler.sh"
  exit 1
fi
# shellcheck source=/dev/null
source "${SCRIPT_DIR}/network_retry.sh"

require_command jq || exit 1
require_command alipay-cli || exit 1
require_command mktemp || exit 1

PRODUCT_TYPE=""
MCC_CONTEXT_RECEIPT=""
QUALIFICATION_GROUP_INDEX=""
FILE_PATHS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --product-type)
      [ $# -ge 2 ] || { echo "❌ 缺少参数值: $1"; exit 1; }
      PRODUCT_TYPE="$2"; shift 2 ;;
    --mcc-context-receipt)
      [ $# -ge 2 ] || { echo "❌ 缺少参数值: $1"; exit 1; }
      MCC_CONTEXT_RECEIPT="$2"; shift 2 ;;
    --qualification-group-index)
      [ $# -ge 2 ] || { echo "❌ 缺少参数值: $1"; exit 1; }
      QUALIFICATION_GROUP_INDEX="$2"; shift 2 ;;
    --file)
      [ $# -ge 2 ] || { echo "❌ 缺少参数值: $1"; exit 1; }
      FILE_PATHS+=("$2"); shift 2 ;;
    *)
      echo "❌ 未知参数: $1"; exit 1 ;;
  esac
done

case "$PRODUCT_TYPE" in
  aipay|webpay|apppay) ;;
  *) echo "❌ 请先传入 --product-type aipay|webpay|apppay"; exit 1 ;;
esac
if [ "${#FILE_PATHS[@]}" -eq 0 ]; then
  echo "❌ 请至少提供一个 --file <localFile>"
  exit 1
fi
if [ -z "$MCC_CONTEXT_RECEIPT" ] || ! [[ "$QUALIFICATION_GROUP_INDEX" =~ ^[1-9][0-9]*$ ]]; then
  echo "❌ 特殊资质上传必须绑定本轮 MCC 上下文和有效资质组合序号"
  exit 1
fi

for FILE_PATH in "${FILE_PATHS[@]}"; do
  if [ -z "$FILE_PATH" ]; then
    echo "❌ --file 不能为空"
    exit 1
  fi
  if [ ! -f "$FILE_PATH" ]; then
    echo "❌ 特殊资质文件不存在: $FILE_PATH"
    exit 1
  fi
done

VALIDATION_JSON=$(jq -cn \
  --arg productType "$PRODUCT_TYPE" \
  --arg mccContextReceipt "$MCC_CONTEXT_RECEIPT" \
  --argjson qualificationGroupIndex "$QUALIFICATION_GROUP_INDEX" \
  '{productType:$productType,mccContextReceipt:$mccContextReceipt,qualificationGroupIndex:$qualificationGroupIndex}') || exit 1
EXPECTED_LICENSE_TYPES_JSON=$(printf '%s' "$VALIDATION_JSON" | node "$ERROR_RENDERER" --resolve-special-license-types 2>/dev/null) || {
  echo "❌ 待上传特殊资质与本轮 MCC 资质组合不一致，已停止上传"
  exit 1
}
if ! printf '%s' "$EXPECTED_LICENSE_TYPES_JSON" | jq -e \
  --argjson fileCount "${#FILE_PATHS[@]}" \
  'type == "array" and length == $fileCount and all(.[]; type == "string" and length > 0)' >/dev/null 2>&1; then
  echo "❌ 特殊资质文件数量与所选组合要求不一致，请按材料提示顺序完整提供"
  exit 1
fi
LICENSE_TYPES=()
INDEX=0
while [ "$INDEX" -lt "${#FILE_PATHS[@]}" ]; do
  LICENSE_TYPE=$(printf '%s' "$EXPECTED_LICENSE_TYPES_JSON" | jq -r --argjson index "$INDEX" '.[$index]') || exit 1
  LICENSE_TYPES+=("$LICENSE_TYPE")
  INDEX=$((INDEX + 1))
done

init_alipay_cli_product "$PRODUCT_TYPE" || exit 1
export ALIPAY_AIPAY_SUPPRESS_AUTH_LOGOUT=1
require_alipay_cli_local_state_access_or_emit || exit "$?"

TMP_BASE="${TMPDIR:-/tmp}"
TMP_BASE="${TMP_BASE%/}"
TMP_JSON=$(mktemp "${TMP_BASE}/special_license.XXXXXX") || { echo "❌ 创建临时文件失败"; exit 1; }
trap 'rm -f "$TMP_JSON"' EXIT
printf '[]\n' > "$TMP_JSON"

parse_upload_ref() {
  local raw="$1"
  if [ "$(detect_error "$raw" "MCP_AUTHENTICATED_CALL")" != "SUCCESS" ]; then
    return 1
  fi
  local unwrapped
  unwrapped=$(unwrap_mcp "$raw")
  echo "$unwrapped" | jq -r '
    .data.fileKey //
    .data.picUrl //
    .data.url //
    .data.fileUrl //
    .data.downloadUrl //
    .data.data.fileKey //
    .data.data.picUrl //
    .data.data.url //
    .data.data.fileUrl //
    .data.data.downloadUrl //
    .fileKey //
    .picUrl //
    .url //
    .fileUrl //
    .downloadUrl //
    .result.fileKey //
    .result.picUrl //
    .result.url //
    .result.fileUrl //
    .result.downloadUrl //
    empty
  ' 2>/dev/null
}

ERRORS=""
UPLOAD_AUTH_ERROR_SEEN=false
INDEX=0
export PLATFORM="${DEV_TOOL_NAME:-unknown}" PLATFORM_ID="${PLATFORM_ID:-}" ALIPAYCLI_BIZ_INFO PRODUCT
for FILE_PATH in "${FILE_PATHS[@]}"; do
  INDEX=$((INDEX + 1))
  LICENSE_TYPE="${LICENSE_TYPES[$((INDEX - 1))]}"
  run_network_retry RAW write "special_license_upload_${INDEX}" -- \
    alipay-cli file upload "$FILE_PATH" -s payMerchantcodeSkill --json
  UPLOAD_RC=$?
  if [ "$UPLOAD_RC" -eq 75 ] || [ "$UPLOAD_RC" -eq "${ALIPAY_CLI_LOCAL_STATE_PERMISSION_EXIT_CODE:-77}" ]; then
    echo "❌ 特殊资质上传结果无法确认，已停止后续上传和签约"
    emit_control "SPECIAL_LICENSE_UPLOAD_RESULT=UNKNOWN"
    exit 1
  fi
  if [ "$UPLOAD_RC" -ne 0 ]; then
    echo "❌ 特殊资质上传因网络或服务异常在安全重试后仍未恢复"
    emit_control "SPECIAL_LICENSE_UPLOAD_RESULT=FAILED"
    exit 1
  fi

  LICENSE_REF=$(parse_upload_ref "$RAW")
  if [ -z "$LICENSE_REF" ]; then
    ERROR_TYPE=$(detect_error "$RAW" "MCP_AUTHENTICATED_CALL")
    if [ "$ERROR_TYPE" = "MCP_AUTH_ERROR" ] && [ "$UPLOAD_AUTH_ERROR_SEEN" = "true" ]; then
      :
    elif ! handle_error "$RAW" "MCP_AUTHENTICATED_CALL"; then
      [ "$ERROR_TYPE" != "MCP_AUTH_ERROR" ] || UPLOAD_AUTH_ERROR_SEEN=true
    fi
    ERRORS="$ERRORS  - 特殊资质文件 ${INDEX} 上传失败或未返回可用于签约的图片引用值"$'\n'
    continue
  fi
  if ! validate_control_value "$LICENSE_REF"; then
    ERRORS="$ERRORS  - 特殊资质文件 ${INDEX} 上传返回值包含非法控制字符"$'\n'
    continue
  fi
  NEXT_JSON=$(jq \
    --arg licenseType "$LICENSE_TYPE" \
    --arg licensePic "$LICENSE_REF" \
    '. + [{licenseType: $licenseType, licensePic: $licensePic}]' "$TMP_JSON") || exit 1
  printf '%s\n' "$NEXT_JSON" > "$TMP_JSON"
done

if [ -n "$ERRORS" ]; then
  echo "❌ 特殊资质上传失败："
  printf "%s" "$ERRORS"
  exit 1
fi

SPECIAL_LICENSE_JSON=$(jq -c . "$TMP_JSON") || exit 1
if ! validate_control_value "$SPECIAL_LICENSE_JSON"; then
  echo "❌ 特殊资质上传结果包含非法控制字符"
  exit 1
fi

echo "✅ 特殊资质上传成功"
emit_control_field "SPECIAL_LICENSE_JSON" "$SPECIAL_LICENSE_JSON" || exit 1
