#!/usr/bin/env bash
set -eu
case "$(uname -s)" in MINGW*|MSYS*) ;; *) exit 78;; esac
for tool in cygpath mktemp chmod stat find sed grep awk tr base64 head tail dirname basename cat mv rm mkdir env curl git; do
  command -v "$tool" >/dev/null || exit 78
done
[[ "$(cygpath -m "$(command -v alipay-cli)")" == "$ALIPAY_WINDOWS_CLI_ENTRY" ]] || exit 78
value='猫抓板 "quoted" $HOME /scope/a https://example.com/a?x=1&y=2'
out=$(printf '%s' "$value" | "$ALIPAY_WINDOWS_JQ" -Rs . | "$ALIPAY_WINDOWS_JQ" -r .)
[[ "$out" == "$value" ]] || exit 78
"$ALIPAY_WINDOWS_NODE" -e 'if(process.argv[1]!==process.env.WINDOWS_PROBE_VALUE) process.exit(78)' "$value" >/dev/null 2>&1 && exit 78
WINDOWS_PROBE_VALUE="$value" "$ALIPAY_WINDOWS_NODE" -e 'if(process.argv[1]!==process.env.WINDOWS_PROBE_VALUE) process.exit(78)' "$value"
"$ALIPAY_WINDOWS_CLI" version >/dev/null
printf 'WINDOWS_PROBE:READY\n'
