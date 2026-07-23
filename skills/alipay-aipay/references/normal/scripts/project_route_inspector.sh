#!/bin/bash

set -u

MODE="${1:-}"
PRODUCT_TYPE=""
PROJECT_PATH=""
PROJECT_SELECTION=""

prepare_new_project() {
  local project_path="$1"
  case "$project_path" in /*) ;; *) echo "ROUTE_INSPECT_ERROR:projectPath 必须是绝对路径" >&2; exit 2 ;; esac
  if [ -L "$project_path" ] || { [ -e "$project_path" ] && { [ ! -d "$project_path" ] || [ -n "$(find "$project_path" -mindepth 1 -maxdepth 1 -print -quit 2>/dev/null)" ]; }; }; then
    echo "ROUTE_INSPECT_ERROR:NEW_PROJECT 路径必须尚不存在或为空且不能是符号链接" >&2
    exit 2
  fi
  jq -n '{projectSelection:"NEW_PROJECT",projectOrigin:"NEW_PROJECT",projectOriginLabel:"本轮新建项目",preparationStatus:"READY"}'
}

case "$MODE" in
  prepare-new)
    [ "$#" -eq 2 ] || { echo "ROUTE_INSPECT_ERROR:用法 project_route_inspector.sh prepare-new <projectPath>" >&2; exit 2; }
    prepare_new_project "$2"
    exit 0
    ;;
  scan)
    [ "$#" -eq 4 ] || { echo "ROUTE_INSPECT_ERROR:用法 project_route_inspector.sh scan <productType> <projectPath> <projectSelection>" >&2; exit 2; }
    PRODUCT_TYPE="$2"
    PROJECT_PATH="$3"
    PROJECT_SELECTION="$4"
    ;;
  *)
    echo "ROUTE_INSPECT_ERROR:用法 project_route_inspector.sh prepare-new <projectPath> 或 scan <productType> <projectPath> <projectSelection>" >&2
    exit 2
    ;;
esac

case "$PRODUCT_TYPE" in aipay|webpay|apppay) ;; *) echo "ROUTE_INSPECT_ERROR:productType 非法" >&2; exit 2 ;; esac
case "$PROJECT_SELECTION" in CURRENT_PROJECT|OTHER_PROJECT|PREPARED_NEW_PROJECT) ;; *) echo "ROUTE_INSPECT_ERROR:projectSelection 非法" >&2; exit 2 ;; esac
case "$PROJECT_PATH" in /*) ;; *) echo "ROUTE_INSPECT_ERROR:projectPath 必须是绝对路径" >&2; exit 2 ;; esac

[ -d "$PROJECT_PATH" ] && [ -r "$PROJECT_PATH" ] || { echo "ROUTE_INSPECT_ERROR:项目路径不可访问" >&2; exit 2; }

if [ "$PROJECT_SELECTION" = "PREPARED_NEW_PROJECT" ]; then
  PROJECT_ORIGIN="NEW_PROJECT"
  PROJECT_ORIGIN_LABEL="本轮新建项目"
else
  PROJECT_ORIGIN="EXISTING_PROJECT"
  PROJECT_ORIGIN_LABEL="现有项目"
fi

scan() {
  local pattern="$1"
  local file
  while IFS= read -r -d '' file; do
    if grep -En "$pattern" "$file" 2>/dev/null | grep -Ev '^[0-9]+:[[:space:]]*(//|#|\*|<!--)' | head -n 1 | grep -q .; then
      printf '%s\n' "$file"
      return 0
    fi
  done < <(find "$PROJECT_PATH" -type d \( \
    -name .git -o -name .hg -o -name .svn -o -name .cache -o -name .gradle -o -name .idea -o \
    -name .next -o -name .nuxt -o -name .pytest_cache -o -name .tox -o -name .Trash -o -name .venv -o \
    -name Library -o -name __pycache__ -o -name build -o -name coverage -o -name dist -o -name node_modules -o -name target -o -name vendor \
  \) -prune -o -type f \( -name '*.java' -o -name '*.kt' -o -name '*.js' -o -name '*.mjs' -o -name '*.cjs' -o -name '*.ts' -o -name '*.tsx' -o -name '*.py' -o -name '*.php' -o -name '*.cs' \) -print0)
}

webpay_marker='alipay\.trade\.page\.pay|AlipayTradePagePay(Request|Model|Response)'
apppay_marker='alipay\.trade\.app\.pay|AlipayTradeAppPay(Request|Model|Response)'
trade_query_marker='alipay\.trade\.query|AlipayTradeQuery(Request|Model|Response)|alipay_trade_query_response'
trade_refund_marker='alipay\.trade\.refund|AlipayTradeRefund(Request|Model|Response)|alipay_trade_refund_response'
trade_refund_query_marker='alipay\.trade\.fastpay\.refund\.query|AlipayTradeFastpayRefundQuery(Request|Model|Response)|alipay_trade_fastpay_refund_query_response'
trade_close_marker='alipay\.trade\.close|AlipayTradeClose(Request|Model|Response)|alipay_trade_close_response'
trade_notify_marker='notify_url|notifyUrl|NotifyUrl|setNotifyUrl|异步通知'
aipay_payment_needed_marker='Payment-Needed'
aipay_payment_proof_marker='Payment-Proof'
aipay_payment_validation_marker='Payment-Validation'
aipay_payment_verify_marker='alipay\.aipay\.agent\.payment\.verify|AlipayAipayAgentPaymentVerify(Request|Model|Response)|alipay_aipay_agent_payment_verify_response'
aipay_fulfillment_confirm_marker='alipay\.aipay\.agent\.fulfillment\.confirm|AlipayAipayAgentFulfillmentConfirm(Request|Model|Response)|alipay_aipay_agent_fulfillment_confirm_response'
aipay_marker="$aipay_payment_needed_marker|$aipay_payment_proof_marker|$aipay_payment_verify_marker|$aipay_fulfillment_confirm_marker"

target_marker=""
other_products=""
case "$PRODUCT_TYPE" in
  aipay) target_marker="$aipay_marker" ;;
  webpay) target_marker="$webpay_marker" ;;
  apppay) target_marker="$apppay_marker" ;;
esac

[ -z "$(scan "$webpay_marker")" ] || [ "$PRODUCT_TYPE" = "webpay" ] || other_products="${other_products}网站支付,"
[ -z "$(scan "$apppay_marker")" ] || [ "$PRODUCT_TYPE" = "apppay" ] || other_products="${other_products}APP 支付,"
[ -z "$(scan "$aipay_marker")" ] || [ "$PRODUCT_TYPE" = "aipay" ] || other_products="${other_products}按量付费,"
other_products="${other_products%,}"
[ -n "$other_products" ] || other_products="无"

if [ -z "$(scan "$target_marker")" ]; then
  if [ "$other_products" = "无" ]; then
    status="NO_PAYMENT"
    if [ "$PROJECT_SELECTION" = "PREPARED_NEW_PROJECT" ]; then
      evidence="固定检查器扫描本轮已初始化的新项目，未发现目标产品或其他受支持支付代码"
    else
      evidence="固定检查器未发现目标产品或其他受支持支付代码"
    fi
  else status="OTHER_PRODUCT_ONLY"; evidence="固定检查器只发现其他受支持支付产品代码"; fi
else
  if [ "$PRODUCT_TYPE" = "aipay" ]; then
    required_patterns=("$aipay_payment_needed_marker" "$aipay_payment_proof_marker" "$aipay_payment_verify_marker" "$aipay_fulfillment_confirm_marker" "$aipay_payment_validation_marker")
  elif [ "$PRODUCT_TYPE" = "webpay" ]; then
    required_patterns=("$webpay_marker" "$trade_query_marker" "$trade_refund_marker" "$trade_refund_query_marker" "$trade_close_marker" "$trade_notify_marker")
  else
    required_patterns=("$apppay_marker" "$trade_query_marker" "$trade_refund_marker" "$trade_refund_query_marker" "$trade_close_marker" "$trade_notify_marker")
  fi
  missing=()
  for pattern in "${required_patterns[@]}"; do
    [ -n "$(scan "$pattern")" ] || missing+=("$pattern")
  done
  if [ "${#missing[@]}" -eq 0 ]; then
    status="TARGET_PARTIAL"
    evidence="固定检查器逐项发现目标产品入口及全部核心接口标记，但静态扫描不能证明配置、安全、测试和 checklist 完成；必须进入 Integration 验证分支"
  else
    status="TARGET_PARTIAL"
    evidence="固定检查器发现目标产品代码，但至少一个核心接口标记缺失；不得按完整集成路由"
  fi
fi

jq -n \
  --arg selection "$PROJECT_SELECTION" \
  --arg origin "$PROJECT_ORIGIN" \
  --arg originLabel "$PROJECT_ORIGIN_LABEL" \
  --arg status "$status" \
  --arg evidence "$evidence" \
  --arg others "$other_products" \
  '{projectSelection:$selection,projectOrigin:$origin,projectOriginLabel:$originLabel,integrationStatus:$status,evidence:$evidence,otherProducts:$others}'
