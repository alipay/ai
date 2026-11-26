#!/usr/bin/env bash
# Loaded only on real Git for Windows; no Linux/macOS command is replaced.
_win_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
_win_exports=$("$ALIPAY_WINDOWS_NODE" "$(cygpath -m "$_win_dir/preflight.mjs")" shell-env) || { exit 78; }
eval "$_win_exports"
unset _win_exports

windows_check_access() {
  "$ALIPAY_WINDOWS_NODE" "$ALIPAY_WINDOWS_ACCESS_SCRIPT" "$(cygpath -m "$1")" >/dev/null
}

git() {
  local args=() previous='' arg
  for arg in "$@"; do
    if [ "$previous" = -C ]; then arg=$(cygpath -m "$arg") || return 78; fi
    args+=("$arg");previous="$arg"
  done
  command git "${args[@]}"
}

# jq is a Bash function so large --argjson values never enter a Windows argv.
# Slurp exactly one JSON value and bind it back to the original variable name.
jq() {
  local args=() files=() bindings='' filter='' name value file rc arg
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --argjson)
        [ "$#" -ge 3 ] || return 64
        name="$2";value="$3";shift 3
        [[ "$name" =~ ^[a-zA-Z_][a-zA-Z0-9_]*$ ]] || return 64
        file=$(mktemp "${TMPDIR}/jq-argument.XXXXXX") || return 78
        printf '%s' "$value" >"$file" || { rm -f "$file"; return 78; }
        files+=("$file");args+=(--slurpfile "$name" "$(cygpath -m "$file")")
        bindings+="(if (\$$name|length)==1 then \$$name[0] else error(\"invalid argjson\") end) as \$$name | "
        ;;
      --arg)
        [ "$#" -ge 3 ] || return 64
        value="$3"
        if [ "$2" = configPath ]; then value=$(cygpath -m "$value") || return 78; fi
        args+=("$1" "$2" "$value");shift 3 ;;
      --argfile|--slurpfile|--rawfile)
        [ "$#" -ge 3 ] || return 64
        value=$(cygpath -m "$3") || return 78
        args+=("$1" "$2" "$value");shift 3 ;;
      -*) args+=("$1");shift ;;
      *) filter="$1";shift;break ;;
    esac
  done
  if [ -n "$filter" ]; then args+=("$bindings$filter"); fi
  for arg in "$@"; do
    if [[ "$arg" == /* ]] && [ -f "$arg" ]; then args+=("$(cygpath -m "$arg")");else args+=("$arg");fi
  done
  if "$ALIPAY_WINDOWS_JQ" "${args[@]}"; then rc=0; else rc=$?; fi
  [ "${#files[@]}" -eq 0 ] || rm -f "${files[@]}"
  return "$rc"
}

node() {
  local args=() catalog='' arg previous='' first=true
  local mcc_cache=false position=0 sandbox_project_position=-1
  [[ ${1:-} == */mcc_cache.mjs ]] && mcc_cache=true
  if [[ ${1:-} == */sandbox_config_core.mjs ]]; then
    if [ "${2:-}" = parse ]; then
      if [ "${3:-}" = summary ]; then sandbox_project_position=4; else sandbox_project_position=3; fi
    elif [ "${2:-}" = summary ]; then sandbox_project_position=3
    else sandbox_project_position=2; fi
  fi
  while [ "$#" -gt 0 ]; do
    arg="$1";shift
    if [ "$arg" = --mcc-catalog-json ]; then
      [ "$#" -gt 0 ] || return 64
      catalog="$1";shift;args+=(--mcc-catalog-json @windows-stdin);continue
    fi
    if { [ "$first" = true ] && [[ "$arg" == /* ]]; } || { [ "$mcc_cache" = true ] && [ "$position" = 2 ]; } || [ "$position" = "$sandbox_project_position" ] || [[ "$previous" =~ ^--(project-path|base-path|config-path|search-base-path|skill-dir)$ ]]; then
      arg=$(cygpath -m "$arg") || return 78
    fi
    args+=("$arg");previous="$arg";first=false;position=$((position + 1))
  done
  if [ -n "$catalog" ]; then printf '%s' "$catalog" | "$ALIPAY_WINDOWS_NODE" "${args[@]}"
  else "$ALIPAY_WINDOWS_NODE" "${args[@]}";fi
}

# Preserve command names and business arguments; only file-upload paths cross
# the POSIX/native boundary here. No fake CLI and no business response rewriting.
alipay-cli() {
  local args=("$@")
  if [ "${1:-}" = file ] && [ "${2:-}" = upload ] && [ "$#" -ge 3 ]; then
    args[2]=$(cygpath -m "$3") || return 78
  fi
  "$ALIPAY_WINDOWS_NODE" "$ALIPAY_WINDOWS_CLI_RUNNER" "${args[@]}"
}
