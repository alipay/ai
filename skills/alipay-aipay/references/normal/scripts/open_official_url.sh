#!/bin/bash

set -u

KIND="${1:-}"
IFS= read -r URL || URL=""
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
POLICY_FILE="${SCRIPT_DIR}/../policy-rules.json"

case "$KIND" in authorization|public-key-confirmation) ;; *) echo "OPEN_FAILED"; exit 1 ;; esac
command -v node >/dev/null 2>&1 || { echo "OPEN_FAILED"; exit 1; }
[ -f "$POLICY_FILE" ] || { echo "OPEN_FAILED"; exit 1; }

if ! node -e '
const fs = require("node:fs");
const [kind, raw, policyFile] = process.argv.slice(1);
const policy = JSON.parse(fs.readFileSync(policyFile, "utf8"));
if (/[\u0000-\u0020\u007f`()\[\]<>|]/.test(raw)) process.exit(1);
let url;
try { url = new URL(raw); } catch { process.exit(1); }
const allowed = policy.temporaryUrlAllowlist[kind === "authorization" ? "authorization" : "publicKeyConfirmation"];
if (!allowed || url.protocol !== "https:" || url.hostname !== allowed.host || url.pathname !== allowed.path || url.username || url.password || url.port || url.hash) process.exit(1);
if (kind === "authorization") {
  const required = allowed.requiredQueryParams;
  const optional = allowed.optionalQueryParams;
  const allowedKeys = new Set([...required, ...optional]);
  if ([...url.searchParams.keys()].some((key) => !allowedKeys.has(key))) process.exit(1);
  for (const key of required) {
    if (url.searchParams.getAll(key).length !== 1 || !url.searchParams.get(key)) process.exit(1);
  }
  for (const key of optional) {
    if (url.searchParams.getAll(key).length > 1) process.exit(1);
  }
  if (!policy.authorizationProducts.some((product) => product.salesCode === url.searchParams.get("productCode"))) process.exit(1);
  if (!/^A\d{4}_B\d{4}$/.test(url.searchParams.get("mccCode"))) process.exit(1);
  if (/[\r\n]/.test(url.searchParams.get("deviceCode"))) process.exit(1);
  if (url.searchParams.has("platform") && (!url.searchParams.get("platform") || /[\r\n]/.test(url.searchParams.get("platform")))) process.exit(1);
} else {
  const required = allowed.requiredQueryParams || ["keyConfirmToken"];
  const optional = allowed.optionalQueryParams || [];
  const allowedKeys = new Set([...required, ...optional]);
  if ([...url.searchParams.keys()].some((key) => !allowedKeys.has(key))) process.exit(1);
  for (const key of required) {
    if (url.searchParams.getAll(key).length !== 1 || !url.searchParams.get(key)) process.exit(1);
  }
  for (const key of optional) {
    if (url.searchParams.getAll(key).length > 1) process.exit(1);
  }
  if (/[\r\n]/.test(url.searchParams.get("keyConfirmToken"))) process.exit(1);
}
' "$KIND" "$URL" "$POLICY_FILE"; then
  echo "OPEN_FAILED"
  exit 1
fi

OS_NAME="$(uname -s 2>/dev/null || true)"
WINDOWS_OPENER=false
if [ "$OS_NAME" = "Darwin" ] && command -v open >/dev/null 2>&1; then
  OPENER=(open)
elif [ "$OS_NAME" = "Linux" ] && command -v xdg-open >/dev/null 2>&1; then
  OPENER=(xdg-open)
elif [[ "$OS_NAME" = MINGW* || "$OS_NAME" = MSYS* || "$OS_NAME" = CYGWIN* ]] && command -v powershell.exe >/dev/null 2>&1; then
  WINDOWS_OPENER=true
  OPENER=(powershell.exe -NoProfile -NonInteractive -Command 'Start-Process -FilePath $env:ALIPAY_AIPAY_OPEN_URL')
else
  echo "GUI_UNAVAILABLE"
  exit 0
fi

if [ "$WINDOWS_OPENER" = true ]; then
  env "ALIPAY_AIPAY_OPEN_URL=$URL" "${OPENER[@]}" >/dev/null 2>&1
  OPEN_RC=$?
else
  "${OPENER[@]}" "$URL" >/dev/null 2>&1
  OPEN_RC=$?
fi

if [ "$OPEN_RC" -eq 0 ]; then
  echo "OPENED"
else
  echo "OPEN_FAILED"
fi
