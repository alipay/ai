#!/bin/bash

set -u

MODE="${1:-}"
PRODUCT_TYPE=""
PROJECT_PATH=""
LANGUAGE=""
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NORMAL_SCRIPTS="${SCRIPT_DIR}/../../../normal/scripts"
RENDERER="${NORMAL_SCRIPTS}/render_customer_message.mjs"
DETECTOR="${NORMAL_SCRIPTS}/detect_dev_tool.sh"

case "$MODE" in
  create|verify|ensure|reverify)
    if [ "${2:-}" = "aipay" ] || [ "${2:-}" = "webpay" ] || [ "${2:-}" = "apppay" ]; then
      echo "SANDBOX_ERROR:${MODE} 不接受 productType 参数；用法 sandbox_config.sh ${MODE} <projectPath> <language>" >&2
      exit 2
    fi
    PROJECT_PATH="${2:-}"
    LANGUAGE="${3:-}"
    ;;
  summary)
    PRODUCT_TYPE="${2:-}"
    PROJECT_PATH="${3:-}"
    LANGUAGE="${4:-}"
    ;;
  *)
    echo "SANDBOX_ERROR:用法 sandbox_config.sh <ensure|reverify|create|verify> <projectPath> <language> 或 sandbox_config.sh summary <productType> <projectPath> <language>" >&2
    exit 2
    ;;
esac

normalize_language() {
  local value compact
  value="${1:-}"
  compact=$(printf '%s' "$value" | tr '[:upper:]' '[:lower:]' | sed 's/[ ._-]//g')
  case "$compact" in
    java) printf '%s\n' "Java" ;;
    python|python3|py) printf '%s\n' "Python" ;;
    nodejs|node|javascript|js) printf '%s\n' "Node.js" ;;
    c#|csharp|dotnet|net) printf '%s\n' "C#" ;;
    php) printf '%s\n' "PHP" ;;
    *) return 1 ;;
  esac
}

LANGUAGE="$(normalize_language "$LANGUAGE")" || {
  echo "SANDBOX_ERROR:语言非法，仅支持 Java|Python|Node.js|C#|PHP；Node.js 请使用 Node.js 或 nodejs" >&2
  exit 2
}

CONFIG_PATH="${PROJECT_PATH}/.alipay-sandbox.json"
GITIGNORE_PATH="${PROJECT_PATH}/.gitignore"

if [ "$MODE" = "summary" ]; then
  case "$PRODUCT_TYPE" in aipay) PRODUCT_NAME="按量付费" ;; webpay) PRODUCT_NAME="网站支付" ;; apppay) PRODUCT_NAME="APP 支付" ;; *) echo "SANDBOX_ERROR:产品非法，仅支持 aipay|webpay|apppay" >&2; exit 2 ;; esac
fi
case "$PROJECT_PATH" in /*) ;; *) echo "SANDBOX_ERROR:项目路径必须为绝对路径" >&2; exit 2 ;; esac
[ -d "$PROJECT_PATH" ] && [ ! -L "$PROJECT_PATH" ] || { echo "SANDBOX_ERROR:项目目录不可访问或不安全" >&2; exit 2; }
detected=()
find "$PROJECT_PATH" -maxdepth 4 -type f \( -name pom.xml -o -name build.gradle -o -name build.gradle.kts \) -print -quit | grep -q . && detected+=(Java)
find "$PROJECT_PATH" -maxdepth 4 -type f -name package.json -print -quit | grep -q . && detected+=(Node.js)
find "$PROJECT_PATH" -maxdepth 4 -type f \( -name requirements.txt -o -name pyproject.toml \) -print -quit | grep -q . && detected+=(Python)
find "$PROJECT_PATH" -maxdepth 4 -type f -name '*.csproj' -print -quit | grep -q . && detected+=(C#)
find "$PROJECT_PATH" -maxdepth 4 -type f -name composer.json -print -quit | grep -q . && detected+=(PHP)
language_detected=false
for detected_language in "${detected[@]}"; do
  [ "$detected_language" = "$LANGUAGE" ] && language_detected=true
done
[ "$language_detected" = true ] || { echo "SANDBOX_ERROR:未发现与已确认语言一致的项目构建标识" >&2; exit 2; }

if [ "$MODE" = "ensure" ] || [ "$MODE" = "reverify" ]; then
  if [ "$MODE" = "reverify" ] || [ -e "$CONFIG_PATH" ] || [ -L "$CONFIG_PATH" ]; then
    ENSURE_MODE="verify"
    ENSURE_ACTION="VERIFIED"
    PENDING_VARIANT="VERIFY"
    PENDING_MARKER="FLOW:SANDBOX_CONFIG_PENDING_VERIFY"
  else
    ENSURE_MODE="create"
    ENSURE_ACTION="CREATED"
    PENDING_VARIANT="CREATE"
    PENDING_MARKER="FLOW:SANDBOX_CONFIG_PENDING_CREATE"
  fi

  attempt=1
  while true; do
    ensure_output=$(bash "$0" "$ENSURE_MODE" "$PROJECT_PATH" "$LANGUAGE" 2>&1)
    ensure_rc=$?
    if [ "$ensure_rc" -eq 0 ] &&
       [ "$(printf '%s\n' "$ensure_output" | grep -Fxc "SANDBOX_CONFIG_PATH=$CONFIG_PATH")" -eq 1 ] &&
       [ "$(printf '%s\n' "$ensure_output" | grep -Fxc 'FLOW:SANDBOX_CONFIG_READY')" -eq 1 ] &&
       ! printf '%s\n' "$ensure_output" | grep -q '^SANDBOX_ERROR:'; then
      echo "SANDBOX_ENSURE_ACTION=$ENSURE_ACTION"
      echo "SANDBOX_CONFIG_PATH=$CONFIG_PATH"
      echo "FLOW:SANDBOX_CONFIG_READY"
      exit 0
    fi

    if [ "$attempt" -lt 3 ] && printf '%s\n' "$ensure_output" | grep -qE \
      'SANDBOX_ERROR:(候选 data 缺少|配置缺少)当前语言或测试账号必含字段'; then
      attempt=$((attempt + 1))
      sleep 3
      continue
    fi
    break
  done

  printf '%s' '{}' | node "$RENDERER" sandbox.configuration.pending --variant "$PENDING_VARIANT" || {
    echo "SANDBOX_ERROR:沙箱待配置消息渲染失败" >&2
    exit 1
  }
  echo "SANDBOX_PENDING_PATH=$CONFIG_PATH"
  echo "$PENDING_MARKER"
  exit 0
fi

extract_json_payload() {
  local raw="$1" line_count span start end candidate normalized selected="" match_count=0
  if normalized=$(printf '%s' "$raw" | jq -sce 'if length == 1 and (.[0] | type == "object") then .[0] else empty end' 2>/dev/null); then
    printf '%s' "$normalized"
    return 0
  fi

  line_count=$(printf '%s\n' "$raw" | awk 'END { print NR }')
  span="$line_count"
  while [ "$span" -ge 1 ]; do
    start=1
    while [ $((start + span - 1)) -le "$line_count" ]; do
      end=$((start + span - 1))
      candidate=$(printf '%s\n' "$raw" | sed -n "${start},${end}p")
      if normalized=$(printf '%s' "$candidate" | jq -sce 'if length == 1 and (.[0] | type == "object") then .[0] else empty end' 2>/dev/null) &&
         printf '%s' "$normalized" | jq -e 'has("success") or ((.result.content[0].text? // .content[0].text?) | type == "string")' >/dev/null 2>&1; then
        if [ "$normalized" != "$selected" ]; then
          selected="$normalized"
          match_count=$((match_count + 1))
        fi
      fi
      start=$((start + 1))
    done
    span=$((span - 1))
  done
  [ "$match_count" -eq 1 ] || return 1
  printf '%s' "$selected"
}

ensure_gitignore_protection() {
  if [ -L "$GITIGNORE_PATH" ] || { [ -e "$GITIGNORE_PATH" ] && [ ! -f "$GITIGNORE_PATH" ]; }; then
    echo "SANDBOX_ERROR:.gitignore 不是安全的普通文件" >&2
    return 1
  fi
  if [ -f "$GITIGNORE_PATH" ] && grep -Fxq '/.alipay-sandbox.json' "$GITIGNORE_PATH"; then
    return 0
  fi
  if [ -s "$GITIGNORE_PATH" ] && [ -n "$(tail -c 1 "$GITIGNORE_PATH" 2>/dev/null)" ]; then
    printf '\n' >>"$GITIGNORE_PATH" || return 1
  fi
  printf '/.alipay-sandbox.json\n' >>"$GITIGNORE_PATH" || return 1
}

ensure_config_not_tracked() {
  command -v git >/dev/null 2>&1 || return 0
  git -C "$PROJECT_PATH" rev-parse --is-inside-work-tree >/dev/null 2>&1 || return 0
  if git -C "$PROJECT_PATH" ls-files --error-unmatch -- '.alipay-sandbox.json' >/dev/null 2>&1; then
    return 1
  fi
  return 0
}

ensure_config_permissions() {
  local mode
  chmod 600 "$CONFIG_PATH" 2>/dev/null || return 1
  if mode=$(stat -f '%Lp' "$CONFIG_PATH" 2>/dev/null); then
    :
  elif mode=$(stat -c '%a' "$CONFIG_PATH" 2>/dev/null); then
    :
  else
    return 1
  fi
  [ "$mode" = "600" ]
}

validate_data() {
  local data="$1"
  echo "$data" | jq -e --arg language "$LANGUAGE" '
    (.appIds|type)=="array" and (.appIds|length)>0 and .appIds[0] as $app |
    ($app.appId|type)=="string" and ($app.appId|length)>0 and
    ($app.alipayPublicKey|type)=="string" and ($app.alipayPublicKey|length)>0 and
    ($app.appPublicKey|type)=="string" and ($app.appPublicKey|length)>0 and
    (if $language=="Java" then ($app.appPrivateKey|type)=="string" and ($app.appPrivateKey|length)>0
     else ($app.appPrivatePkcsKey|type)=="string" and ($app.appPrivatePkcsKey|length)>0 end) and
    (.sandboxAccounts.partner.userId|type)=="string" and (.sandboxAccounts.partner.userId|length)>0 and
    (.sandboxAccounts.user.userId|type)=="string" and (.sandboxAccounts.user.userId|length)>0 and
    (.sandboxAccounts.user.email|type)=="string" and (.sandboxAccounts.user.email|length)>0 and
    (.sandboxAccounts.user.logonPassword|type)=="string" and (.sandboxAccounts.user.logonPassword|length)>0 and
    (.sandboxAccounts.user.payPassword|type)=="string" and (.sandboxAccounts.user.payPassword|length)>0
  ' >/dev/null 2>&1
}

render_summary() {
  local data="$1" rows input
  rows=$(echo "$data" | jq -r '
    def safe: tostring|gsub("[|\\r\\n]";" ");
    .appIds[0] as $app |
    ["| 应用 | appId="+($app.appId|safe)+", pid="+(($app.pid//"未返回")|safe)+" |",
     "| 商家账号 | userId="+(.sandboxAccounts.partner.userId|safe)+" |",
     "| 买家账号 | userId="+(.sandboxAccounts.user.userId|safe)+", 登录账号="+(.sandboxAccounts.user.email|safe)+", 登录密码="+(.sandboxAccounts.user.logonPassword|safe)+", 支付密码="+(.sandboxAccounts.user.payPassword|safe)+" |",
     "| 沙箱 | sandboxId="+((.sandboxId//"未返回")|safe)+" |"] | join("\n")
  ') || return 1
  input=$(jq -cn --arg productName "$PRODUCT_NAME" --arg configPath "$CONFIG_PATH" --arg environmentRows "$rows" '{productName:$productName,configPath:$configPath,environmentRows:$environmentRows}') || return 1
  printf '%s' "$input" | node "$RENDERER" sandbox.environment.summary --variant DEFAULT || return 1
  printf '%s' '{}' | node "$RENDERER" sandbox.environment.reminder --variant DEFAULT || return 1
}

if [ "$MODE" = "create" ]; then
  command -v alipay-cli >/dev/null 2>&1 || { echo "SANDBOX_ERROR:缺少 alipay-cli" >&2; exit 1; }
  { [ ! -e "$CONFIG_PATH" ] && [ ! -L "$CONFIG_PATH" ]; } || { echo "SANDBOX_ERROR:配置文件已存在或为不安全符号链接，禁止重复创建或覆盖" >&2; exit 1; }
  ensure_config_not_tracked || { echo "SANDBOX_ERROR:沙箱配置路径已被 Git 跟踪，必须先从版本控制中移除" >&2; exit 1; }
  ensure_gitignore_protection || { echo "SANDBOX_ERROR:无法为沙箱配置建立 Git 忽略保护" >&2; exit 1; }
  PLATFORM=$(bash "$DETECTOR") || PLATFORM="unknown"
  attempt=1
  while true; do
    raw=$(env -u PRODUCT PLATFORM="$PLATFORM" alipay-cli mcp call alipay-anonymous-sandbox.createAnonymousSandbox --data '{"request":{"appType":"PUBLICAPP"}}' --json 2>&1)
    rc=$?
    [ "$rc" -eq 0 ] && break
    if printf '%s' "$raw" | grep -qiE '版本过旧|version.*old'; then break; fi
    if [ "$attempt" -lt 3 ] && printf '%s' "$raw" | grep -qiE 'MCP_SERVICE_ERROR|SERVICE_UNSTABLE|timeout|timed out|connection|network|ECONN|socket|temporar'; then
      attempt=$((attempt + 1))
      sleep 3
      continue
    fi
    break
  done
  [ "$rc" -eq 0 ] || { echo "SANDBOX_ERROR:快速沙箱 CLI 调用失败" >&2; exit 1; }
  outer=$(extract_json_payload "$raw") || { echo "SANDBOX_ERROR:CLI 输出中未找到唯一合法 JSON 对象" >&2; exit 1; }
  text=$(echo "$outer" | jq -r '.result.content[0].text // .content[0].text // empty')
  if [ -n "$text" ]; then
    business=$(printf '%s' "$text" | jq -c . 2>/dev/null) || { echo "SANDBOX_ERROR:content[0].text 不是合法 JSON" >&2; exit 1; }
  else
    business="$outer"
  fi
  if [ "$(echo "$business" | jq -r '.success // false')" != "true" ] && echo "$business" | jq -r '.msg // .resultMsg // ""' | grep -q '证书密钥'; then
    sleep 2
    raw=$(env -u PRODUCT PLATFORM="$PLATFORM" alipay-cli mcp call alipay-anonymous-sandbox.createAnonymousSandbox --data '{"request":{"appType":"PUBLICAPP"}}' --json 2>&1)
    rc=$?
    [ "$rc" -eq 0 ] || { echo "SANDBOX_ERROR:证书密钥临时错误重试后 CLI 调用失败" >&2; exit 1; }
    outer=$(extract_json_payload "$raw") || { echo "SANDBOX_ERROR:重试输出中未找到唯一合法 JSON 对象" >&2; exit 1; }
    text=$(echo "$outer" | jq -r '.result.content[0].text // .content[0].text // empty')
    if [ -n "$text" ]; then business=$(printf '%s' "$text" | jq -c . 2>/dev/null) || { echo "SANDBOX_ERROR:重试 content[0].text 非法" >&2; exit 1; }; else business="$outer"; fi
  fi
  [ "$(echo "$business" | jq -r '.success // false')" = "true" ] || {
    echo "$business" | jq -r '"SANDBOX_ERROR:"+(.errorCode//"UNKNOWN"|tostring)+" "+(.msg//.resultMsg//"快速沙箱创建失败")+" traceId="+(.traceId//"未返回"|tostring)' >&2
    exit 1
  }
  data=$(echo "$business" | jq -c '.data // null') || exit 1
  validate_data "$data" || { echo "SANDBOX_ERROR:候选 data 缺少当前语言或测试账号必含字段" >&2; exit 1; }
  temp=$(mktemp "${PROJECT_PATH}/.alipay-sandbox.XXXXXX") || exit 1
  chmod 600 "$temp" 2>/dev/null || true
  printf '%s\n' "$data" >"$temp" || { rm -f "$temp"; exit 1; }
  mv "$temp" "$CONFIG_PATH" || { rm -f "$temp"; exit 1; }
  ensure_config_permissions || { echo "SANDBOX_ERROR:无法确认配置权限为 0600" >&2; exit 1; }
elif [ "$MODE" = "verify" ]; then
  [ -f "$CONFIG_PATH" ] && [ ! -L "$CONFIG_PATH" ] || { echo "SANDBOX_ERROR:配置文件不存在或不安全" >&2; exit 1; }
  ensure_config_not_tracked || { echo "SANDBOX_ERROR:沙箱配置已被 Git 跟踪，必须先从版本控制中移除" >&2; exit 1; }
  ensure_gitignore_protection || { echo "SANDBOX_ERROR:无法为沙箱配置建立 Git 忽略保护" >&2; exit 1; }
  data=$(jq -c . "$CONFIG_PATH" 2>/dev/null) || { echo "SANDBOX_ERROR:配置不是合法 JSON" >&2; exit 1; }
  validate_data "$data" || { echo "SANDBOX_ERROR:配置缺少当前语言或测试账号必含字段" >&2; exit 1; }
  ensure_config_permissions || { echo "SANDBOX_ERROR:无法确认配置权限为 0600" >&2; exit 1; }
elif [ "$MODE" = "summary" ]; then
  [ -f "$CONFIG_PATH" ] && [ ! -L "$CONFIG_PATH" ] || { echo "SANDBOX_ERROR:配置文件不存在或不安全" >&2; exit 1; }
  ensure_config_not_tracked || { echo "SANDBOX_ERROR:沙箱配置已被 Git 跟踪，必须先从版本控制中移除" >&2; exit 1; }
  ensure_gitignore_protection || { echo "SANDBOX_ERROR:无法为沙箱配置建立 Git 忽略保护" >&2; exit 1; }
  data=$(jq -c . "$CONFIG_PATH" 2>/dev/null) || { echo "SANDBOX_ERROR:配置不是合法 JSON" >&2; exit 1; }
  validate_data "$data" || { echo "SANDBOX_ERROR:配置缺少当前语言或测试账号必含字段" >&2; exit 1; }
  ensure_config_permissions || { echo "SANDBOX_ERROR:无法确认配置权限为 0600" >&2; exit 1; }
else
  echo "SANDBOX_ERROR:用法 sandbox_config.sh <ensure|reverify|create|verify> <projectPath> <language> 或 sandbox_config.sh summary <productType> <projectPath> <language>" >&2
  exit 2
fi

if [ "$MODE" = "summary" ]; then
  render_summary "$data" || exit 1
  echo "SANDBOX_CONFIG_PATH=$CONFIG_PATH"
  echo "FLOW:SANDBOX_CONFIGURED"
  exit 0
fi

echo "SANDBOX_CONFIG_PATH=$CONFIG_PATH"
echo "FLOW:SANDBOX_CONFIG_READY"
