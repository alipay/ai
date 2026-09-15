#!/bin/bash

set -u

KIND="${1:-}"
IFS= read -r URL || URL=""
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
POLICY_FILE="${SCRIPT_DIR}/../json/policy-rules.json"

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
OPEN_ERROR_KIND_REPORTED=false
OPEN_TIMEOUT_MS=3000
if [ "${ALIPAY_AIPAY_TEST_MODE:-}" = 1 ] && [[ "${ALIPAY_AIPAY_OPEN_TIMEOUT_MS:-}" =~ ^[1-9][0-9]*$ ]]; then
  OPEN_TIMEOUT_MS="$ALIPAY_AIPAY_OPEN_TIMEOUT_MS"
fi

emit_internal() { printf 'ALIPAY_AIPAY_INTERNAL:%s\n' "$*" >&2; }
emit_open_error_kind() {
  if [ "$OPEN_ERROR_KIND_REPORTED" != true ]; then
    emit_internal "OPEN_ERROR_KIND=$1"
    OPEN_ERROR_KIND_REPORTED=true
  fi
}

diagnose_failed_open() {
  [ "$1" = macos-open ] && [ -f "$2" ] || return 0
  grep -qiE 'NSOSStatusErrorDomain|kLSExecutableIncorrectFormat|-10661' "$2" || return 0
  emit_open_error_kind "MACOS_LAUNCHSERVICES"
  grep -q -- '-10661' "$2" && emit_internal "OPEN_ERROR_CODE=-10661"
}

run_open_command() {
  local KIND="$1" ERROR_FILE OPEN_RC OPEN_TIMEOUT_SENTINEL
  shift
  ERROR_FILE=$(mktemp "${TMPDIR:-/tmp}/alipay-aipay-open.XXXXXX" 2>/dev/null || true)
  OPEN_TIMEOUT_SENTINEL="ALIPAY_AIPAY_OPEN_TIMEOUT_${$}_${RANDOM:-0}"
  node -e '
const { spawn } = require("node:child_process");
const [timeoutSentinel, timeout, command, ...args] = process.argv.slice(1);
const child = spawn(command, args, {
  detached: true,
  stdio: ["ignore", "ignore", "pipe"],
});

let stderr = "";
let finished = false;
let timedOut = false;
const outputLimit = 64 * 1024;
const appendStderr = (chunk) => {
  stderr += chunk.toString("utf8");
  if (stderr.length > outputLimit) stderr = stderr.slice(-outputLimit);
};
const finish = (code, includeTimeoutSentinel = false) => {
  if (finished) return;
  finished = true;
  clearTimeout(timeoutTimer);
  const output = `${stderr}${includeTimeoutSentinel ? `${timeoutSentinel}\n` : ""}`;
  if (output) process.stderr.write(output, () => process.exit(code));
  else process.exit(code);
};
const killGroup = (signal) => {
  if (!child.pid) return;
  try { process.kill(-child.pid, signal); } catch {}
};

child.stderr.on("data", appendStderr);
child.once("error", () => finish(125));
child.once("close", (status) => {
  if (!timedOut) finish(Number.isInteger(status) ? status : 125);
});

const timeoutTimer = setTimeout(() => {
  timedOut = true;
  killGroup("SIGTERM");
  setTimeout(() => {
    killGroup("SIGKILL");
    finish(124, true);
  }, 100);
}, Number(timeout));

if (!Number.isFinite(Number(timeout)) || Number(timeout) <= 0) {
  finish(125);
}
' "$OPEN_TIMEOUT_SENTINEL" "$OPEN_TIMEOUT_MS" "$@" >/dev/null 2>"${ERROR_FILE:-/dev/null}"
  OPEN_RC=$?
  if [ "$OPEN_RC" -eq 124 ] && [ -n "$ERROR_FILE" ] && grep -Fqx -- "$OPEN_TIMEOUT_SENTINEL" "$ERROR_FILE"; then
    emit_open_error_kind "OPENER_TIMEOUT"
  elif [ "$OPEN_RC" -ne 0 ] && [ -n "$ERROR_FILE" ]; then
    diagnose_failed_open "$KIND" "$ERROR_FILE"
  fi
  [ -z "$ERROR_FILE" ] || rm -f "$ERROR_FILE" 2>/dev/null || true
  return "$OPEN_RC"
}

open_with_unix_fallbacks() {
  local TRIED=false
  command -v xdg-open >/dev/null 2>&1 && { TRIED=true; run_open_command xdg-open xdg-open "$URL" && return 0; }
  command -v gio >/dev/null 2>&1 && { TRIED=true; run_open_command gio gio open "$URL" && return 0; }
  command -v sensible-browser >/dev/null 2>&1 && { TRIED=true; run_open_command sensible-browser sensible-browser "$URL" && return 0; }
  if [ "$TRIED" != true ]; then
    emit_open_error_kind "GUI_UNAVAILABLE"
    return 2
  fi
  if [ -z "${DISPLAY:-}" ] && [ -z "${WAYLAND_DISPLAY:-}" ] && [ -z "${MIR_SOCKET:-}" ]; then
    emit_open_error_kind "GUI_UNAVAILABLE"
  else emit_open_error_kind "OPENER_FAILED"; fi
  return 1
}

open_url() {
  local OPEN_BIN TRIED
  case "$OS_NAME" in
    Darwin)
      TRIED=false
      OPEN_BIN="$(command -v open 2>/dev/null || true)"
      if [ -n "$OPEN_BIN" ]; then
        TRIED=true
        run_open_command "macos-open" "$OPEN_BIN" "$URL" && return 0
      fi
      if command -v osascript >/dev/null 2>&1; then
        TRIED=true
        run_open_command osascript osascript \
          -e 'on run argv' -e 'open location (item 1 of argv)' -e 'end run' \
          "$URL" && return 0
      fi
      if [ "$TRIED" = true ]; then
        emit_open_error_kind "OPENER_FAILED"
        return 1
      fi
      emit_open_error_kind "GUI_UNAVAILABLE"
      return 2
      ;;
    Linux|FreeBSD|NetBSD|OpenBSD|DragonFly|SunOS|AIX)
      open_with_unix_fallbacks; return $?
      ;;
    MINGW*|MSYS*|CYGWIN*)
      if command -v powershell.exe >/dev/null 2>&1; then
        env "ALIPAY_AIPAY_OPEN_URL=$URL" powershell.exe -NoProfile -NonInteractive -Command \
          'Start-Process -FilePath $env:ALIPAY_AIPAY_OPEN_URL' >/dev/null 2>&1 && return 0
        emit_open_error_kind "OPENER_FAILED"
        return 1
      fi
      emit_open_error_kind "GUI_UNAVAILABLE"
      return 2
      ;;
    *)
      emit_open_error_kind "GUI_UNAVAILABLE"
      return 2
      ;;
  esac
}

open_url
OPEN_RC=$?
case "$OPEN_RC" in
  0) echo "OPENED" ;;
  2) echo "GUI_UNAVAILABLE" ;;
  *) echo "OPEN_FAILED" ;;
esac
