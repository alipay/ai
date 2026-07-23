#!/bin/bash

set -u
umask 077

MANUAL_URL="https://opendocs.alipay.com/isv/02kipk"
DEST_DIR="${1:-}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RENDERER="${SCRIPT_DIR}/../../../normal/scripts/render_customer_message.mjs"

manual_fallback_message() {
  echo "未能完成自动下载，可能是当前环境不支持、无法访问下载源、本地目录不可写或安装包校验未通过。请访问支付宝开放平台手动下载支付宝开放平台密钥工具："
  echo
  echo "$MANUAL_URL"
  echo
  echo "仅向 Agent 提供【应用公钥】，应用私钥请自行妥善保管。"
}

render_fallback() {
  if command -v node >/dev/null 2>&1 && [ -f "$RENDERER" ]; then
    printf '%s' '{}' | ALIPAY_AIPAY_RENDERER_MANAGED_CALLER=download_key_tool.sh node "$RENDERER" key_tool.download.fallback --variant DEFAULT && return 0
  fi
  manual_fallback_message
}

render_downloaded() {
  local target_file="$1"
  local message_input
  if command -v node >/dev/null 2>&1 && [ -f "$RENDERER" ]; then
    message_input=$(node -e 'process.stdout.write(JSON.stringify({downloadPath: process.argv[1]}))' "$target_file") \
      && printf '%s' "$message_input" | ALIPAY_AIPAY_RENDERER_MANAGED_CALLER=download_key_tool.sh node "$RENDERER" key_tool.download.result --variant DOWNLOADED \
      && return 0
  fi
  render_fallback
}

fail_download() {
  render_fallback
  exit 0
}

is_windows_reparse_point() {
  local path="$1" powershell_rc
  case "$(uname -s 2>/dev/null || true)" in MINGW*|MSYS*|CYGWIN*) ;; *) return 1 ;; esac
  command -v powershell.exe >/dev/null 2>&1 || return 0
  env "ALIPAY_AIPAY_REPARSE_PATH=$path" powershell.exe -NoProfile -NonInteractive -Command '
    try {
      $item = Get-Item -LiteralPath $env:ALIPAY_AIPAY_REPARSE_PATH -Force -ErrorAction Stop
    } catch {
      exit 2
    }
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { exit 0 } else { exit 1 }
  ' >/dev/null 2>&1
  powershell_rc=$?
  [ "$powershell_rc" -eq 0 ] && return 0
  [ "$powershell_rc" -eq 1 ] && return 1
  return 0
}

OS_NAME="${ALIPAY_AIPAY_TEST_OS:-$(uname -s 2>/dev/null || true)}"
case "$OS_NAME" in
  Darwin) PLATFORM="mac"; EXT="dmg" ;;
  MINGW*|MSYS*|CYGWIN*|Windows_NT) PLATFORM="win"; EXT="exe" ;;
  *) fail_download "UNSUPPORTED_OS" ;;
esac

if [ -z "$DEST_DIR" ]; then
  DEST_DIR="${HOME:-}/Downloads"
fi
[ -n "$DEST_DIR" ] && [ -d "$DEST_DIR" ] && [ -w "$DEST_DIR" ] && [ ! -L "$DEST_DIR" ] || fail_download "DEST_DIR_UNAVAILABLE"
! is_windows_reparse_point "$DEST_DIR" || fail_download "DEST_DIR_UNAVAILABLE"
command -v curl >/dev/null 2>&1 || fail_download "DEPENDENCY_MISSING"
command -v node >/dev/null 2>&1 || fail_download "DEPENDENCY_MISSING"

CURRENT_URL="https://ideservice.alipay.com/ide/getPluginUrl.htm?clientType=assistant&platform=${PLATFORM}&channelType=WEB"
PART_FILE=$(mktemp "${DEST_DIR}/.alipay-key-tool.XXXXXX.part") || fail_download "DEST_DIR_UNAVAILABLE"
HEADER_FILE=$(mktemp "${DEST_DIR}/.alipay-key-tool.XXXXXX.headers") || { rm -f "$PART_FILE"; fail_download "DEST_DIR_UNAVAILABLE"; }
chmod 600 "$PART_FILE" "$HEADER_FILE" 2>/dev/null || true
cleanup_download() { rm -f "$PART_FILE" "$HEADER_FILE"; }
trap cleanup_download EXIT INT TERM

REDIRECTS=0
while true; do
  : > "$PART_FILE"
  : > "$HEADER_FILE"
  curl --silent --show-error --connect-timeout 10 --max-time 120 --dump-header "$HEADER_FILE" --output "$PART_FILE" --max-redirs 0 "$CURRENT_URL" 2>/dev/null
  CURL_RC=$?
  STATUS=$(awk '/^HTTP\// {code=$2; sub(/\r$/, "", code)} END {print code}' "$HEADER_FILE")
  [ -n "$STATUS" ] || fail_download "NETWORK_UNAVAILABLE"
  case "$STATUS" in
    301|302|303|307|308)
      [ "$REDIRECTS" -lt 5 ] || fail_download "UNTRUSTED_REDIRECT"
      LOCATION=$(awk 'tolower($0) ~ /^location:/ {sub(/^[^:]*:[[:space:]]*/, ""); sub(/\r$/, ""); print; exit}' "$HEADER_FILE")
      [ -n "$LOCATION" ] || fail_download "UNTRUSTED_REDIRECT"
      if ! node -e '
const [raw] = process.argv.slice(1); let u;
try { u = new URL(raw); } catch { process.exit(1); }
if (u.protocol !== "https:" || u.username || u.password || u.port) process.exit(1);
if (!["ideservice.alipay.com", "mdn.alipayobjects.com"].includes(u.hostname)) process.exit(1);
' "$LOCATION"; then fail_download "UNTRUSTED_REDIRECT"; fi
      CURRENT_URL="$LOCATION"
      REDIRECTS=$((REDIRECTS + 1))
      ;;
    200)
      [ "$CURL_RC" -eq 0 ] || fail_download "NETWORK_UNAVAILABLE"
      FINAL_HOST=$(node -e 'console.log(new URL(process.argv[1]).hostname)' "$CURRENT_URL" 2>/dev/null) || fail_download "UNTRUSTED_REDIRECT"
      [ "$FINAL_HOST" = "mdn.alipayobjects.com" ] || fail_download "UNTRUSTED_REDIRECT"
      break
      ;;
    *) fail_download "NETWORK_UNAVAILABLE" ;;
  esac
done

DISPOSITION=$(awk 'tolower($0) ~ /^content-disposition:/ {sub(/\r$/, ""); print; exit}' "$HEADER_FILE")
FILENAME=$(printf '%s' "$DISPOSITION" | sed -n 's/.*filename="\{0,1\}\([^";]*\)"\{0,1\}.*/\1/p')
if [ -z "$FILENAME" ]; then
  FILENAME=$(node -e '
let url;
try { url = new URL(process.argv[1]); } catch { process.exit(1); }
process.stdout.write(url.searchParams.get("af_fileName") || "");
' "$CURRENT_URL") || fail_download "INVALID_PACKAGE"
fi
case "$FILENAME" in ""|*/*|*\\*|.|..) fail_download "INVALID_PACKAGE" ;; esac
if ! node -e '
const name = process.argv[1] || "";
if (/[\u0000-\u001f\u007f`|]/.test(name)) process.exit(1);
' "$FILENAME"; then fail_download "INVALID_PACKAGE"; fi
case "$FILENAME" in *.$EXT) ;; *) fail_download "INVALID_PACKAGE" ;; esac

SIZE=$(wc -c < "$PART_FILE" | tr -d ' ')
[ "$SIZE" -gt 0 ] || fail_download "INVALID_PACKAGE"
CONTENT_LENGTH=$(awk 'tolower($0) ~ /^content-length:/ {sub(/\r$/, ""); sub(/^[^:]*:[[:space:]]*/, ""); print; exit}' "$HEADER_FILE")
if [ -n "$CONTENT_LENGTH" ]; then
  case "$CONTENT_LENGTH" in *[!0-9]*) fail_download "INVALID_PACKAGE" ;; esac
  [ "$SIZE" -eq "$CONTENT_LENGTH" ] || fail_download "INVALID_PACKAGE"
fi
FIRST_NONSPACE=$(LC_ALL=C tr -d '[:space:]' < "$PART_FILE" | head -c 1)
case "$FIRST_NONSPACE" in '<'|'{'|'[') fail_download "INVALID_PACKAGE" ;; esac
if [ "$EXT" = "exe" ]; then
  [ "$(head -c 2 "$PART_FILE")" = "MZ" ] || fail_download "INVALID_PACKAGE"
else
  LC_ALL=C grep -a -q 'koly' "$PART_FILE" || fail_download "INVALID_PACKAGE"
fi

TARGET_FILE="${DEST_DIR}/${FILENAME}"
if [ -e "$TARGET_FILE" ] || [ -L "$TARGET_FILE" ]; then
  BASE="${FILENAME%.*}"
  TARGET_FILE="${DEST_DIR}/${BASE}-$(date +%Y%m%d%H%M%S)-$$.${EXT}"
fi
[ ! -e "$TARGET_FILE" ] && [ ! -L "$TARGET_FILE" ] || fail_download "DEST_DIR_UNAVAILABLE"
ln "$PART_FILE" "$TARGET_FILE" || fail_download "DEST_DIR_UNAVAILABLE"
rm -f "$PART_FILE"
trap - EXIT INT TERM
rm -f "$HEADER_FILE"
[ -f "$TARGET_FILE" ] && [ ! -L "$TARGET_FILE" ] || fail_download "DEST_DIR_UNAVAILABLE"
chmod 600 "$TARGET_FILE" 2>/dev/null || true
render_downloaded "$TARGET_FILE"
