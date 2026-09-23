#!/bin/bash
#=============================================================================
# 脚本名称: upload_screenshots.sh
# 功能描述: 串行上传截图文件并解析可用于签约的图片引用值
# 调用位置: Step 4 签约材料类别
# 调用前置: 脚本通过 error_handler.sh 间接初始化 DEV_TOOL_NAME/PLATFORM_ID；需传入产品类型和3个文件路径
# 用法: bash upload_screenshots.sh --product-type <webpay|apppay> "$HOME_IMG" "$SHOP_IMG" "$PAY_IMG"
# 返回值: stdout 仅输出上传结果；stderr 输出图片引用值控制信号
#=============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# 一次性 source error_handler（含 unwrap_mcp）
if [ -f "${SCRIPT_DIR}/error_handler.sh" ]; then
  source "${SCRIPT_DIR}/error_handler.sh"
else
  echo "❌ 缺少错误处理脚本: ${SCRIPT_DIR}/error_handler.sh"
  exit 1
fi

require_command jq || exit 1
require_command alipay-cli || exit 1
require_command mktemp || exit 1

if [ "${1:-}" != "--product-type" ] || [ "$#" -lt 5 ]; then
  echo "❌ 请先传入 --product-type webpay|apppay"
  exit 1
fi
PRODUCT_TYPE="$2"
shift 2
case "$PRODUCT_TYPE" in
  webpay|apppay) ;;
  *) echo "❌ 截图上传仅支持 webpay|apppay"; exit 1 ;;
esac
init_alipay_cli_product "$PRODUCT_TYPE" || exit 1
export ALIPAY_AIPAY_SUPPRESS_AUTH_LOGOUT=1

HOME_IMG="${1:-}"
SHOP_IMG="${2:-}"
PAY_IMG="${3:-}"

# 校验参数
if [ -z "$HOME_IMG" ] || [ -z "$SHOP_IMG" ] || [ -z "$PAY_IMG" ]; then
  echo "❌ 请提供 3 个截图文件路径"
  echo "用法: bash upload_screenshots.sh --product-type <webpay|apppay> <首页截图> <商品页截图> <支付页截图>"
  echo "  AI 网页应用收款：传入网站首页、商品页、支付页截图"
  echo "  AI 移动应用收款：传入 APP 首页、商品页、支付页截图"
  exit 1
fi

# 校验文件存在性
if [ ! -f "$HOME_IMG" ]; then
  echo "❌ 首页截图文件不存在: $HOME_IMG"
  exit 1
fi
if [ ! -f "$SHOP_IMG" ]; then
  echo "❌ 商品页截图文件不存在: $SHOP_IMG"
  exit 1
fi
if [ ! -f "$PAY_IMG" ]; then
  echo "❌ 支付页截图文件不存在: $PAY_IMG"
  exit 1
fi

require_alipay_cli_local_state_access_or_emit || exit "$?"

# 使用 mktemp 创建并发安全的临时文件。模板需以 XXXXXX 结尾以兼容 macOS/BSD mktemp。
TMP_BASE="${TMPDIR:-/tmp}"
TMP_BASE="${TMP_BASE%/}"
TMP_HOME=""
TMP_SHOP=""
TMP_PAY=""
TMP_HOME_ERR=""
TMP_SHOP_ERR=""
TMP_PAY_ERR=""

# 清理临时文件，包括只创建了部分文件时的失败分支。
cleanup_upload_tmp() {
  local tmp_file
  for tmp_file in "$TMP_HOME" "$TMP_SHOP" "$TMP_PAY" "$TMP_HOME_ERR" "$TMP_SHOP_ERR" "$TMP_PAY_ERR"; do
    [ -z "$tmp_file" ] || rm -f "$tmp_file"
  done
}
trap cleanup_upload_tmp EXIT

TMP_HOME=$(mktemp "${TMP_BASE}/upload_home.XXXXXX") || { echo "❌ 创建临时文件失败"; exit 1; }
TMP_SHOP=$(mktemp "${TMP_BASE}/upload_shop.XXXXXX") || { echo "❌ 创建临时文件失败"; exit 1; }
TMP_PAY=$(mktemp "${TMP_BASE}/upload_pay.XXXXXX") || { echo "❌ 创建临时文件失败"; exit 1; }
TMP_HOME_ERR=$(mktemp "${TMP_BASE}/upload_home_err.XXXXXX") || { echo "❌ 创建临时文件失败"; exit 1; }
TMP_SHOP_ERR=$(mktemp "${TMP_BASE}/upload_shop_err.XXXXXX") || { echo "❌ 创建临时文件失败"; exit 1; }
TMP_PAY_ERR=$(mktemp "${TMP_BASE}/upload_pay_err.XXXXXX") || { echo "❌ 创建临时文件失败"; exit 1; }

# 已验证多个 file upload 进程会竞争本地认证态；三张截图固定串行。
# PLATFORM_ID、ALIPAYCLI_BIZ_INFO 与 PRODUCT 均由公共上下文初始化。
PLATFORM="${DEV_TOOL_NAME:-unknown}" PLATFORM_ID="${PLATFORM_ID:-}" ALIPAYCLI_BIZ_INFO="$ALIPAYCLI_BIZ_INFO" PRODUCT="${PRODUCT:-}" alipay-cli file upload "$HOME_IMG" -s payMerchantcodeSkill --json >"$TMP_HOME" 2>"$TMP_HOME_ERR"
HOME_UPLOAD_RC=$?
PLATFORM="${DEV_TOOL_NAME:-unknown}" PLATFORM_ID="${PLATFORM_ID:-}" ALIPAYCLI_BIZ_INFO="$ALIPAYCLI_BIZ_INFO" PRODUCT="${PRODUCT:-}" alipay-cli file upload "$SHOP_IMG" -s payMerchantcodeSkill --json >"$TMP_SHOP" 2>"$TMP_SHOP_ERR"
SHOP_UPLOAD_RC=$?
PLATFORM="${DEV_TOOL_NAME:-unknown}" PLATFORM_ID="${PLATFORM_ID:-}" ALIPAYCLI_BIZ_INFO="$ALIPAYCLI_BIZ_INFO" PRODUCT="${PRODUCT:-}" alipay-cli file upload "$PAY_IMG" -s payMerchantcodeSkill --json >"$TMP_PAY" 2>"$TMP_PAY_ERR"
PAY_UPLOAD_RC=$?

upload_combined_output() {
  local stdout_file="$1" stderr_file="$2"
  printf '%s\n%s' "$(cat "$stdout_file")" "$(cat "$stderr_file")"
}

# 解析图片引用值（兼容 file upload 返回 fileKey 或 URL 字段）
parse_image_ref() {
  local RAW
  RAW=$(upload_combined_output "$1" "$2")
  if [ "$(detect_error "$RAW" "MCP_AUTHENTICATED_CALL")" != "SUCCESS" ]; then
    return 1
  fi
  # alipay-cli file upload 可能返回 MCP 信封，先解包
  local UNWRAPPED=$(unwrap_mcp "$RAW")
  echo "$UNWRAPPED" | jq -r '
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

HOME_REF=$(parse_image_ref "$TMP_HOME" "$TMP_HOME_ERR")
SHOP_REF=$(parse_image_ref "$TMP_SHOP" "$TMP_SHOP_ERR")
PAY_REF=$(parse_image_ref "$TMP_PAY" "$TMP_PAY_ERR")

# 校验上传结果（含认证错误检测）
check_upload_error() {
  local RAW
  local ERROR_TYPE
  RAW=$(upload_combined_output "$1" "$2")
  ERROR_TYPE=$(detect_error "$RAW" "MCP_AUTHENTICATED_CALL")
  if [ "$ERROR_TYPE" = "CLI_LOCAL_FS_PERMISSION" ]; then
    UPLOAD_LOCAL_FS_AFTER_DISPATCH=true
    return 1
  fi
  if [ "$ERROR_TYPE" = "MCP_AUTH_ERROR" ] && [ "${UPLOAD_AUTH_ERROR_SEEN:-false}" = "true" ]; then
    return 1
  fi
  if ! handle_error "$RAW" "MCP_AUTHENTICATED_CALL"; then
    if [ "$ERROR_TYPE" = "MCP_AUTH_ERROR" ]; then
      UPLOAD_AUTH_ERROR_SEEN=true
    fi
    return 1
  fi
  return 0
}

ERRORS=""
UPLOAD_LOCAL_FS_AFTER_DISPATCH=false
if [ -z "$HOME_REF" ]; then
  if ! check_upload_error "$TMP_HOME" "$TMP_HOME_ERR"; then
    ERRORS="$ERRORS  - 首页截图上传失败（认证或服务异常）"$'\n'
  else
    ERRORS="$ERRORS  - 首页截图上传后未返回可用于签约的图片引用值"$'\n'
  fi
fi
if [ -z "$SHOP_REF" ]; then
  if ! check_upload_error "$TMP_SHOP" "$TMP_SHOP_ERR"; then
    ERRORS="$ERRORS  - 商品页截图上传失败（认证或服务异常）"$'\n'
  else
    ERRORS="$ERRORS  - 商品页截图上传后未返回可用于签约的图片引用值"$'\n'
  fi
fi
if [ -z "$PAY_REF" ]; then
  if ! check_upload_error "$TMP_PAY" "$TMP_PAY_ERR"; then
    ERRORS="$ERRORS  - 支付页截图上传失败（认证或服务异常）"$'\n'
  else
    ERRORS="$ERRORS  - 支付页截图上传后未返回可用于签约的图片引用值"$'\n'
  fi
fi

if [ -n "$ERRORS" ]; then
  if [ "$UPLOAD_LOCAL_FS_AFTER_DISPATCH" = true ]; then
    emit_control "SCREENSHOT_UPLOAD_RESULT=UNKNOWN"
  fi
  echo "❌ 截图上传失败："
  printf "%s" "$ERRORS"
  exit 1
fi

if ! validate_control_value "$HOME_REF" || ! validate_control_value "$SHOP_REF" || ! validate_control_value "$PAY_REF"; then
  echo "❌ 截图上传返回的图片引用包含非法控制字符"
  exit 1
fi

echo "✅ 截图上传成功"
emit_control_field "SCREENSHOT_HOME_REF" "$HOME_REF" || exit 1
emit_control_field "SCREENSHOT_SHOP_REF" "$SHOP_REF" || exit 1
emit_control_field "SCREENSHOT_PAY_REF" "$PAY_REF" || exit 1
