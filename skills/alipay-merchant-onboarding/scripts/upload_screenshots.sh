#!/bin/bash
# 并行上传截图文件并解析 fileKey
# 用法: 传入 3 个文件路径参数
#   bash upload_screenshots.sh "$HOME_IMG" "$SHOP_IMG" "$PAY_IMG"
# 返回: 输出上传结果和 fileKey

HOME_IMG="$1"
SHOP_IMG="$2"
PAY_IMG="$3"

# 校验参数
if [ -z "$HOME_IMG" ] || [ -z "$SHOP_IMG" ] || [ -z "$PAY_IMG" ]; then
  echo "❌ 请提供 3 个截图文件路径"
  echo "用法: bash upload_screenshots.sh <首页截图> <商品页截图> <支付页截图>"
  exit 1
fi

# 并行上传 3 张截图
export PLATFORM=${DEV_TOOL_NAME} && alipay-cli file upload "$HOME_IMG" -s payMerchantcodeSkill --json 2>/dev/null > /tmp/upload_home.json &
export PLATFORM=${DEV_TOOL_NAME} && alipay-cli file upload "$SHOP_IMG" -s payMerchantcodeSkill --json 2>/dev/null > /tmp/upload_shop.json &
export PLATFORM=${DEV_TOOL_NAME} && alipay-cli file upload "$PAY_IMG" -s payMerchantcodeSkill --json 2>/dev/null > /tmp/upload_pay.json &
wait

# 解析 fileKey（兼容多种返回结构）
parse_file_key() {
  local RESULT=$(cat "$1")
  echo "$RESULT" | jq -r '.data.fileKey // .data.data.fileKey // .fileKey // .result.fileKey // empty'
}

HOME_KEY=$(parse_file_key /tmp/upload_home.json)
SHOP_KEY=$(parse_file_key /tmp/upload_shop.json)
PAY_KEY=$(parse_file_key /tmp/upload_pay.json)

# 校验上传结果
ERRORS=""
if [ -z "$HOME_KEY" ]; then
  ERRORS="$ERRORS\n  - 首页截图上传失败"
fi
if [ -z "$SHOP_KEY" ]; then
  ERRORS="$ERRORS\n  - 商品页截图上传失败"
fi
if [ -z "$PAY_KEY" ]; then
  ERRORS="$ERRORS\n  - 支付页截图上传失败"
fi

if [ -n "$ERRORS" ]; then
  echo "❌ 截图上传失败：$ERRORS"
  exit 1
fi

echo "✅ 截图上传成功"
echo "  - 首页截图: $HOME_KEY"
echo "  - 商品页截图: $SHOP_KEY"
echo "  - 支付页截图: $PAY_KEY"
echo ""
echo "# 更新对话上下文状态："
echo "# collect_information = {\"pc_home_page_image\":\"$HOME_KEY\",\"pc_shop_page_image\":\"$SHOP_KEY\",\"pc_payment_image\":\"$PAY_KEY\"}"