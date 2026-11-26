#!/bin/bash
#=============================================================================
# 脚本名称: mcc.sh
# 功能描述: 查询当前产品支持的 MCC 经营类目并托管 MCC 匹配与方案展示
# 调用位置: Step 1 方案规划
# 用法:
#   bash mcc.sh resolve-plan --query <经营描述|MCC编码> --product-type <aipay|webpay|apppay> --root-intent <onboarding_only|full_process> [--semantic-terms-json <JSON数组>] [--agent-candidate-refs-json <JSON数组>] [--select <MCC编码> --selection-receipt <receipt>] [--input-id <USER_INPUT_ID>]
#=============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ -f "${SCRIPT_DIR}/../error-handling/error_handler.sh" ]; then
  # shellcheck source=/dev/null
  source "${SCRIPT_DIR}/../error-handling/error_handler.sh"
else
  echo "❌ 缺少错误处理脚本: ${SCRIPT_DIR}/../error-handling/error_handler.sh"
  exit 1
fi
# shellcheck source=/dev/null
source "${SCRIPT_DIR}/../error-handling/network_retry.sh"

ONBOARDING_RUNNER="${SCRIPT_DIR}/../../../normal/scripts/onboarding_message_runner.mjs"
MCC_SEMANTIC_RETRY_LIMIT=2

require_command jq || exit 1
require_command node || exit 1
require_command mktemp || exit 1

product_sales_code() {
  case "$1" in
    aipay) printf 'I1080300001000160457' ;;
    webpay) printf 'I1080300001000041203' ;;
    apppay) printf 'I1080300001000041313' ;;
    *) return 1 ;;
  esac
}

extract_business_json() {
  local raw="$1"
  local business
  business=$(unwrap_mcp "$raw")
  printf '%s' "$business" | jq -ce 'select(type == "object")' 2>/dev/null
}

capture_or_exit() {
  local __result_var="$1" output rc
  shift
  output=$("$@")
  rc=$?
  if [ "$rc" -ne 0 ]; then
    [ -z "$output" ] || printf '%s\n' "$output"
    exit "$rc"
  fi
  printf -v "$__result_var" '%s' "$output"
}

network_failure() {
  echo "❌ MCC 经营类目查询因网络或服务异常在自动重试两次后仍未恢复"
  emit_control "MCC_FLOW:RETRY_WITH_NETWORK"
  exit 1
}

mcc_query_failed() {
  echo "经营类目匹配暂时未完成，本次未继续授权或签约。请重新发送一次经营描述，我会重新匹配；如果仍未完成，请稍后再试。"
  emit_control "MCC_QUERY_RESULT=FAILED"
  exit 1
}

ensure_mcc_cli_success() {
  local error_type
  error_type=$(detect_error "$1" "MCP_AUTHENTICATED_CALL")
  [ "$error_type" = "SUCCESS" ]
}

mcc_cache_ttl_seconds() {
  local value="${ALIPAY_AIPAY_MCC_TREE_CACHE_TTL_SECONDS:-1800}"
  case "$value" in
    ''|*[!0-9]*) printf '1800' ;;
    *) printf '%s' "$value" ;;
  esac
}

mcc_cache_scope_id() {
  local candidate="${ALIPAY_AIPAY_RUN_ID:-${ALIPAY_AIPAY_FLOW_RUN_ID:-}}" marker telemetry_script
  if valid_platform_id "$candidate"; then
    printf '%s' "$candidate"
    return 0
  fi
  telemetry_script="${SCRIPT_DIR}/../../../normal/scripts/telemetry.mjs"
  if [ -f "$telemetry_script" ] && command -v node >/dev/null 2>&1; then
    marker="$(node "$telemetry_script" current-run-id 2>&1 >/dev/null || true)"
    candidate="$(printf '%s\n' "$marker" | sed -n 's/^ALIPAY_AIPAY_INTERNAL:RUN_ID=//p' | head -n 1)"
    if valid_platform_id "$candidate"; then
      printf '%s' "$candidate"
      return 0
    fi
  fi
  return 1
}

mcc_cache_root() {
  local configured_cache="${ALIPAY_AIPAY_MCC_CACHE_DIR:-${ALIPAY_AIPAY_NEW_MCC_CACHE_DIR:-}}"
  if [ -n "$configured_cache" ]; then
    if declare -F windows_check_access >/dev/null && [[ "$configured_cache" =~ ^[a-zA-Z]:[/\\] ]]; then
      cygpath -u "$configured_cache"; return $?
    fi
    case "$configured_cache" in
      /*) printf '%s' "$configured_cache"; return 0 ;;
      *) return 1 ;;
    esac
  fi
  if [ -n "${XDG_CACHE_HOME:-}" ]; then
    case "$XDG_CACHE_HOME" in
      /*) printf '%s/alipay-aipay-new/mcc-query-tree' "$XDG_CACHE_HOME"; return 0 ;;
      *) return 1 ;;
    esac
  fi
  case "${HOME:-}" in
    /*) [ "$HOME" != "/" ] || return 1; printf '%s/.cache/alipay-aipay-new/mcc-query-tree' "$HOME" ;;
    *) return 1 ;;
  esac
}

mcc_cache_component() {
  printf '%s' "$1" | LC_ALL=C tr -c 'A-Za-z0-9._-' '_'
}

mcc_cache_file() {
  local product_type="$1" sales_code="$2" root scope
  root="$(mcc_cache_root)" || return 1
  scope="$(mcc_cache_scope_id)" || return 1
  if [ -e "$root" ] && { [ ! -d "$root" ] || [ -L "$root" ]; }; then
    return 1
  fi
  mkdir -p "$root" 2>/dev/null || return 1
  chmod 700 "$root" 2>/dev/null || true
  printf '%s/%s.%s.%s.json' \
    "$root" \
    "$(mcc_cache_component "$scope")" \
    "$(mcc_cache_component "$product_type")" \
    "$(mcc_cache_component "$sales_code")"
}

mcc_selection_cache_file() {
  local product_type="$1" sales_code="$2" receipt="$3" root scope digest
  root="$(mcc_cache_root)" || return 1
  scope="$(mcc_cache_scope_id)" || return 1
  case "$receipt" in
    AIPAY_MCC_SELECTION_V1.*.*) ;;
    *) return 1 ;;
  esac
  digest="${receipt##*.}"
  case "$digest" in
    ''|*[!A-Za-z0-9_-]*) return 1 ;;
  esac
  [ "${#digest}" -ge 32 ] && [ "${#digest}" -le 128 ] || return 1
  if [ -e "$root" ] && { [ ! -d "$root" ] || [ -L "$root" ]; }; then
    return 1
  fi
  mkdir -p "$root" 2>/dev/null || return 1
  chmod 700 "$root" 2>/dev/null || true
  printf '%s/%s.%s.%s.selection.v4.%s.json' \
    "$root" \
    "$(mcc_cache_component "$scope")" \
    "$(mcc_cache_component "$product_type")" \
    "$(mcc_cache_component "$sales_code")" \
    "$digest"
}

read_mcc_tree_cache() {
  local product_type="$1" sales_code="$2" file now ttl
  file="$(mcc_cache_file "$product_type" "$sales_code")" || return 1
  [ -f "$file" ] && [ ! -L "$file" ] || return 1
  now="$(date +%s 2>/dev/null)" || return 1
  ttl="$(mcc_cache_ttl_seconds)"
  jq -ce \
    --arg productType "$product_type" \
    --arg salesCode "$sales_code" \
    --argjson now "$now" \
    --argjson ttl "$ttl" '
      if .schemaVersion == 1
        and .productType == $productType
        and .salesCode == $salesCode
        and ((.createdAtEpoch // null) | type == "number")
        and (($now - .createdAtEpoch) >= 0)
        and (($now - .createdAtEpoch) <= $ttl)
        and (.tree.success == true)
        and ((.tree.resultObj.childrenNodes // null) | type == "array")
      then .tree
      else empty
      end
    ' "$file" 2>/dev/null
}

write_mcc_tree_cache() {
  local product_type="$1" sales_code="$2" tree="$3" file dir now tmp
  file="$(mcc_cache_file "$product_type" "$sales_code")" || return 0
  dir="${file%/*}"
  now="$(date +%s 2>/dev/null)" || return 0
  tmp="$(mktemp "$dir/.mcc-tree.XXXXXX" 2>/dev/null)" || return 0
  chmod 600 "$tmp" 2>/dev/null || true
  if ! jq -cn \
    --arg productType "$product_type" \
    --arg salesCode "$sales_code" \
    --argjson createdAtEpoch "$now" \
    --argjson tree "$tree" \
    '{
      schemaVersion: 1,
      productType: $productType,
      salesCode: $salesCode,
      createdAtEpoch: $createdAtEpoch,
      tree: $tree
    }' >"$tmp" 2>/dev/null; then
    rm -f "$tmp" 2>/dev/null || true
    return 0
  fi
  mv "$tmp" "$file" 2>/dev/null || {
    rm -f "$tmp" 2>/dev/null || true
    return 0
  }
}

read_mcc_selection_cache() {
  local product_type="$1" sales_code="$2" receipt="$3" file
  file="$(mcc_selection_cache_file "$product_type" "$sales_code" "$receipt")" || return 1
  [ -f "$file" ] && [ ! -L "$file" ] || return 1
  jq -ce --arg product "$product_type" --arg sales "$sales_code" --arg receipt "$receipt" \
    --argjson now "$(date +%s)" --argjson ttl "$(mcc_cache_ttl_seconds)" '
    select(.schemaVersion == 4 and .productType == $product and .salesCode == $sales
      and .selectionReceipt == $receipt and ($now - .createdAtEpoch | . >= 0 and . <= $ttl)) |
    .catalog | select(type == "array" and length >= 1 and length <= 8)
  ' "$file" 2>/dev/null
}

write_mcc_selection_cache() {
  local product_type="$1" sales_code="$2" receipt="$3" catalog="$4" root scope
  root="$(mcc_cache_root)" && scope="$(mcc_cache_scope_id)" || return 0
  # The matcher already bound the query and terms to this receipt; only
  # official catalog data crosses the private cache writer's stdin.
  printf '%s' "$catalog" | "${NODE_BINARY:-node}" "$SCRIPT_DIR/mcc_cache.mjs" selection-write \
    "$root" "$(mcc_cache_ttl_seconds)" "$(mcc_cache_component "$scope")" "$product_type" \
    "$sales_code" "$MCC_SEMANTIC_RETRY_LIMIT" "$receipt" || true
}

mcc_input_cache() {
  local action="$1" product="$2" sales="$3" input="$4" query="${5:-}" terms="${6:-[]}" digest="${7:-}" codes="${8:-[]}" scope root
  scope="$(mcc_cache_scope_id)" || return 2
  root="$(mcc_cache_root)" || return 2
  printf '%s\0%s\0%s\0%s\0%s' "$input" "$query" "$terms" "$digest" "$codes" |
    "${NODE_BINARY:-node}" "$SCRIPT_DIR/mcc_cache.mjs" "$action" "$root" "$(mcc_cache_ttl_seconds)" \
      "$(mcc_cache_component "$scope")" "$product" "$sales" "$MCC_SEMANTIC_RETRY_LIMIT"
}

get_mcc_tree() {
  local product_type="$1" sales_code="$2" cached tree cached_rows
  cached="$(read_mcc_tree_cache "$product_type" "$sales_code" 2>/dev/null || true)"
  if [ -n "$cached" ]; then
    cached_rows="$(printf '%s' "$cached" | mcc_rows_from_tree 2>/dev/null || true)"
    if printf '%s' "$cached_rows" | jq -e 'type == "array" and length > 0' >/dev/null 2>&1; then
      printf '%s' "$cached"
      return 0
    fi
  fi
  capture_or_exit tree query_mcc_tree "$sales_code"
  write_mcc_tree_cache "$product_type" "$sales_code" "$tree"
  printf '%s' "$tree"
}

query_mcc_tree() {
  local sales_code="$1" request_json raw retry_rc business rows
  prepare_mcc_cli || exit 1
  request_json=$(jq -n \
    --arg salesCode "$sales_code" \
    '{request:{channelCode:"B_SK_SH_RPC",salesProductCodes:[$salesCode]},ctx:{}}') || return 1

  export PLATFORM="${DEV_TOOL_NAME}" PLATFORM_ID="${PLATFORM_ID:-}"
  run_network_retry raw read query_mcc -- alipay-cli mcp call ar-support.queryMcc \
    -d "$request_json" --json
  retry_rc=$?
  if [ "$retry_rc" -eq "${ALIPAY_CLI_LOCAL_STATE_PERMISSION_EXIT_CODE:-77}" ]; then
    exit "$retry_rc"
  fi
  [ "$retry_rc" -eq 0 ] || network_failure
  ensure_mcc_cli_success "$raw" || mcc_query_failed
  business=$(extract_business_json "$raw") || {
    mcc_query_failed
  }
  if ! printf '%s' "$business" | jq -e '.success == true and (.resultObj.childrenNodes | type == "array")' >/dev/null 2>&1; then
    mcc_query_failed
  fi
  rows="$(printf '%s' "$business" | mcc_rows_from_tree 2>/dev/null || true)"
  if ! printf '%s' "$rows" | jq -e 'type == "array" and length > 0' >/dev/null 2>&1; then
    mcc_query_failed
  fi
  printf '%s' "$business"
}

# MCC may precede the flow's environment check. Cached trees and local matching
# never enter this preparation; only an actual external CLI query does.
prepare_mcc_cli() {
  local prepared_cli
  prepared_cli=$("${NODE_BINARY:-node}" "$SCRIPT_DIR/../../../normal/scripts/alipay_cli_preparation.mjs" prepare) || return 1
  if [ -n "$prepared_cli" ]; then
    if declare -F windows_check_access >/dev/null; then
      prepared_cli=$(cygpath -u "$prepared_cli") || return 1
    fi
    PATH="${prepared_cli%/*}:$PATH"; export PATH
  fi
  require_command alipay-cli && (
    # Isolate the tool probe without changing the following MCC query's context.
    unset PLATFORM PLATFORM_ID PRODUCT ALIPAYCLI_BIZ_INFO
    alipay-cli version >/dev/null 2>&1
  )
}

mcc_rows_from_tree() {
  jq -ce '
    def nonblank_string: type == "string" and test("\\S");
    def mcc_row($primary):
      . as $node |
      if (($node.code? | type) != "string" or ($node.code | test("^B[0-9]{4}$") | not)) then
        error("queryMcc returned invalid selectable mcc code")
      elif (($node.name? | nonblank_string) | not) then
        error("queryMcc returned missing mcc name")
      elif (($node.description? | nonblank_string) | not) then
        error("queryMcc returned missing mcc description")
      elif (($node.needSpecialQual? | type) != "boolean") then
        error("queryMcc returned invalid needSpecialQual")
      elif (($node.childrenNodes? // []) | type) != "array"
        or (($node.childrenNodes? // []) | length) > 0 then
        error("queryMcc returned invalid selectable mcc hierarchy")
      else
        {
          fullCode: ($primary + "_" + $node.code),
          mccCode: $node.code,
          treeName: $node.name,
          treeDescription: $node.description,
          treeNeedSpecialQual: $node.needSpecialQual
        }
      end;
    [
      .resultObj.childrenNodes[]? |
      . as $primary |
      if (($primary.code? | type) != "string" or ($primary.code | test("^A[0-9]{4}$") | not)) then
        error("queryMcc returned invalid primary mcc code")
      elif (($primary.childrenNodes? | type) != "array") then
        error("queryMcc returned invalid primary mcc hierarchy")
      else
        $primary.childrenNodes[]? | mcc_row($primary.code)
      end
    ] as $rows |
    if ($rows | length) == 0 then
      error("queryMcc returned no selectable mcc")
    elif (($rows | map(.fullCode) | unique | length) != ($rows | length)) then
      error("queryMcc returned duplicate selectable mcc")
    else
      ($rows
        | sort_by(.fullCode)
        | to_entries
        | map(.value + {mccRef: ("mcc-" + ((.key + 1) | tostring))}))
    end
  ' 2>/dev/null
}

normalize_mcc_tree_catalog() {
  local rows_json="$1"
  jq -cn --argjson rows "$rows_json" '
    ($rows |
      map({
        mccCode: .fullCode,
        mccName: .treeName,
        mccDescription: .treeDescription,
        needSpecialQual: .treeNeedSpecialQual,
        qualificationGroups: []
      }) |
      sort_by(.mccCode) |
      to_entries |
      map(.value + {mccRef: ("mcc-" + ((.key + 1) | tostring))}))
  ' 2>/dev/null
}

rows_for_full_codes() {
  local rows_json="$1" full_codes_json="$2"
  jq -cn --argjson rows "$rows_json" --argjson fullCodes "$full_codes_json" '
    ($fullCodes | unique) as $wanted |
    [
      $rows[] |
      select(.fullCode as $code | $wanted | index($code))
    ]
  ' 2>/dev/null
}

query_mcc_details() {
  local rows_json="$1" mcc_codes_json total details
  mcc_codes_json=$(printf '%s' "$rows_json" | jq -c '[.[].mccCode] | unique' 2>/dev/null) || return 1
  if ! printf '%s' "$mcc_codes_json" | jq -e 'length > 0' >/dev/null 2>&1; then
    mcc_query_failed
  fi
  total=$(printf '%s' "$mcc_codes_json" | jq -r 'length' 2>/dev/null) || mcc_query_failed
  [ "$total" -le 8 ] || mcc_query_failed
  capture_or_exit details query_mcc_detail_chunk "$mcc_codes_json"
  printf '%s' "$details"
}

query_mcc_detail_chunk() {
  local mcc_codes_json="$1" request_json raw retry_rc business
  prepare_mcc_cli || exit 1
  request_json=$(jq -n --argjson mccCodes "$mcc_codes_json" '{request:{mccCodes:$mccCodes}}') || return 1

  export PLATFORM="${DEV_TOOL_NAME}" PLATFORM_ID="${PLATFORM_ID:-}"
  run_network_retry raw read batch_query_mcc -- alipay-cli mcp call mccsearchservice.batchQueryMcc \
    -d "$request_json" --json
  retry_rc=$?
  if [ "$retry_rc" -eq "${ALIPAY_CLI_LOCAL_STATE_PERMISSION_EXIT_CODE:-77}" ]; then
    exit "$retry_rc"
  fi
  [ "$retry_rc" -eq 0 ] || network_failure
  ensure_mcc_cli_success "$raw" || mcc_query_failed
  business=$(extract_business_json "$raw") || {
    mcc_query_failed
  }
  if ! printf '%s' "$business" | jq -e '.success == true and (.mccDetails | type == "array") and (.truncated // false | not)' >/dev/null 2>&1; then
    mcc_query_failed
  fi
  printf '%s' "$business"
}

mcc_match_error_kind() {
  case "$1" in
    *尚无有效采集偏好*) printf 'CONSENT_CONTEXT_UNAVAILABLE' ;;
    *请先解析当前宿主会话*|*必要上下文无法保存*|*业务任务未建立*) printf 'SESSION_CONTEXT_UNAVAILABLE' ;;
    *agent-candidate-refs-json*) printf 'INVALID_AGENT_CANDIDATE_REFS' ;;
    *semantic-terms-json*) printf 'INVALID_SEMANTIC_TERMS' ;;
    *mcc-catalog-json*) printf 'INVALID_DYNAMIC_CATALOG' ;;
    *) printf 'MATCHER_RUNTIME_ERROR' ;;
  esac
}

normalize_mcc_catalog() {
  local rows_json="$1" details_json="$2"
  jq -cn --argjson rows "$rows_json" --argjson details "$details_json" '
    ($details.mccDetails // []) as $detailList |
    ($rows | map(select(.treeNeedSpecialQual == true) | .mccCode) | unique) as $requiredCodes |
    ($detailList | map(select(.success != true) | .mccCode) | unique) as $failedCodes |
    if ($failedCodes | length) > 0 then
      error("batchQueryMcc returned failed mcc details")
    else
      ($detailList | map(.mccCode) | unique) as $detailCodes |
      ($requiredCodes - $detailCodes) as $missingCodes |
      ($detailCodes - $requiredCodes) as $unexpectedCodes |
      if (($detailCodes | length) != ($detailList | length)) then
        error("batchQueryMcc returned duplicate mcc details")
      elif ($missingCodes | length) > 0 then
        error("batchQueryMcc missed required qualification details")
      elif ($unexpectedCodes | length) > 0 then
        error("batchQueryMcc returned unrequested mcc details")
      else
        (reduce $detailList[] as $detail ({}; .[$detail.mccCode] = $detail)) as $detailByCode |
        [
          $rows[] |
          . as $row |
          ($detailByCode[$row.mccCode]) as $detail |
          {
            mccCode: $row.fullCode,
            mccName: $row.treeName,
            mccDescription: $row.treeDescription,
            needSpecialQual: $row.treeNeedSpecialQual,
            mccRef: $row.mccRef,
            qualificationGroups: (if $row.treeNeedSpecialQual then
              (($detail.qualificationGroups // []) | map({
                qualifications: ((.qualifications // []) | map({
                  attaType: (if (.attaType == null or .attaType == "") then null else (.attaType | tostring) end),
                  qualId: (if (.qualId == null) then null else (.qualId | tostring) end),
                  qualName: ((.qualName // "") | tostring),
                  qualType: (if (.qualType == null) then null else (.qualType | tostring) end),
                  status: (if (.status == null) then null else (.status | tostring) end)
                }))
              }))
            else
              []
            end)
          }
        ] as $catalog |
        if any($catalog[];
          (.needSpecialQual == true) !=
          (([.qualificationGroups[]? | select((.qualifications | length) > 0)] | length) > 0)
        ) or any($catalog[]; any(.qualificationGroups[]?; (.qualifications | length) == 0)) then
          error("batchQueryMcc returned inconsistent qualification groups")
        else
          $catalog
        end
      end
    end
  ' 2>/dev/null
}

# Keep both streams in memory. Tag stdout so customer messages can be
# separated from control records without temporary copies of either stream.
capture_mcc_runner() {
  { "${NODE_BINARY:-node}" "$@" | sed 's/^/MCC_STDOUT:/'; return "${PIPESTATUS[0]}"; } 2>&1
}

run_mcc_match_codes() {
  local query="$1" product_type="$2" root_intent="$3" catalog="$4" semantic_terms_json="$5" agent_candidate_refs_json="${6:-}" input_id="${7:-}" catalog_digest="$8" agent_candidate_refs_provided="${9:-false}" output runner_rc resolution=""
  local runner_error error_kind repair_payload candidate_codes
  local node_args=(
    "$ONBOARDING_RUNNER" mcc-match-codes
    --query "$query" \
    --product-type "$product_type" \
    --root-intent "$root_intent" \
    --mcc-catalog-json "$catalog" \
    --semantic-terms-json "$semantic_terms_json"
  )
  if [ "$agent_candidate_refs_provided" = true ]; then
    node_args+=(--agent-candidate-refs-json "$agent_candidate_refs_json")
  fi
  output="$(capture_mcc_runner "${node_args[@]}")"
  runner_rc=$?
  if [ "$runner_rc" -ne 0 ] || printf '%s\n' "$output" | grep '^MCC_STDOUT:' >/dev/null; then
    runner_error="$(printf '%s\n' "$output" | sed -n 's/^ONBOARDING_MESSAGE_ERROR://p' | head -n 1)"
    error_kind="$(mcc_match_error_kind "$runner_error")"
    if [ "$error_kind" = "INVALID_AGENT_CANDIDATE_REFS" ] && [ "$agent_candidate_refs_provided" = true ]; then
      if mcc_input_cache review-repair "$product_type" "$(product_sales_code "$product_type")" "$input_id" "$query" "$semantic_terms_json" "$catalog_digest"; then
        repair_payload=$(jq -cn --argjson catalog "$catalog" '{
          required:true, attempt:2, maxAttempts:2, reason:"INVALID_AGENT_CANDIDATE_REFS",
          instructions:{returnOnlyCatalogRefs:true,deduplicate:true,rankByRelevance:true,maxCandidates:8},
          catalog:($catalog | map({ref:.mccRef,mccName,mccDescription}))
        }') || mcc_query_failed
        jq -cn --argjson agentRepair "$repair_payload" '{matchType:"REPAIR",agentRepair:$agentRepair}'
        return 0
      fi
      emit_control "MCC_MATCH_ERROR=AGENT_REPAIR_EXHAUSTED"
      mcc_query_failed
    fi
    emit_control "MCC_MATCH_ERROR=$error_kind"
    case "$error_kind" in
      CONSENT_CONTEXT_UNAVAILABLE|SESSION_CONTEXT_UNAVAILABLE)
        emit_control "MCC_QUERY_RESULT=FAILED"
        exit 1 ;;
    esac
    mcc_query_failed
  fi
  resolution="$(printf '%s\n' "$output" | sed -n 's/^ALIPAY_AIPAY_INTERNAL:MCC_RESOLUTION=//p')"
  [ -n "$resolution" ] || mcc_query_failed
  if [ "$agent_candidate_refs_provided" = true ] && [ "$(printf '%s' "$resolution" | jq -r '.semanticStatus')" = "AGENT_CATALOG_REVIEW_USED" ]; then
    candidate_codes=$(printf '%s' "$resolution" | jq -c '.mergedCandidateCodes') || mcc_query_failed
    if ! mcc_input_cache review-result "$product_type" "$(product_sales_code "$product_type")" "$input_id" "$query" "$semantic_terms_json" "$catalog_digest" "$candidate_codes"; then
      emit_control "MCC_MATCH_ERROR=AGENT_RESULT_STATE_INVALID"
      mcc_query_failed
    fi
  fi
  printf '%s' "$resolution"
}

validate_mcc_selection_cache() {
  local query="$1" product_type="$2" selection_receipt="$3" catalog="$4" semantic_terms_json="$5"
  "${NODE_BINARY:-node}" "$ONBOARDING_RUNNER" mcc-validate-selection-cache \
    --query "$query" \
    --product-type "$product_type" \
    --selection-receipt "$selection_receipt" \
    --mcc-catalog-json "$catalog" \
    --semantic-terms-json "$semantic_terms_json" >/dev/null 2>&1
}

run_resolve_plan() {
  local query="" product_type="" root_intent="" semantic_terms_json='[]' agent_candidate_refs_json="" agent_candidate_refs_provided=false tree_catalog_digest="" agent_repair_required=false agent_repair_payload="" select_value="" selection_receipt="" input_id="" sales_code tree rows tree_catalog resolution match_type semantic_status full_codes candidate_rows qualification_rows details catalog used_selection_cache=false stale_selection=false retry_rc=0 next_retry_count=0 retry_reason="" retry_payload="" agent_review_required="false" agent_review_payload=""
  shift
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --query)
        [ $# -ge 2 ] || { echo "❌ 缺少参数值: $1"; exit 1; }
        query="$2"; shift 2 ;;
      --product-type)
        [ $# -ge 2 ] || { echo "❌ 缺少参数值: $1"; exit 1; }
        product_type="$2"; shift 2 ;;
      --root-intent)
        [ $# -ge 2 ] || { echo "❌ 缺少参数值: $1"; exit 1; }
        root_intent="$2"; shift 2 ;;
      --semantic-terms-json)
        [ $# -ge 2 ] || { echo "❌ 缺少参数值: $1"; exit 1; }
        semantic_terms_json="$2"; shift 2 ;;
      --agent-candidate-refs-json)
        [ $# -ge 2 ] || { echo "❌ 缺少参数值: $1"; exit 1; }
        agent_candidate_refs_json="$2"; agent_candidate_refs_provided=true; shift 2 ;;
      --select)
        [ $# -ge 2 ] || { echo "❌ 缺少参数值: $1"; exit 1; }
        select_value="$2"; shift 2 ;;
      --selection-receipt)
        [ $# -ge 2 ] || { echo "❌ 缺少参数值: $1"; exit 1; }
        selection_receipt="$2"; shift 2 ;;
      --input-id)
        [ $# -ge 2 ] || { echo "❌ 缺少参数值: $1"; exit 1; }
        input_id="$2"; shift 2 ;;
      *)
        echo "❌ 未知参数: $1"; exit 1 ;;
    esac
  done
  if [ -z "$query" ] || [ -z "$product_type" ]; then
    echo "❌ 缺少 --query 或 --product-type"
    exit 1
  fi
  case "$root_intent" in
    onboarding_only|full_process) ;;
    *)
      echo "❌ 缺少或非法 --root-intent，仅支持 onboarding_only、full_process"
      exit 1
      ;;
  esac
  semantic_terms_json=$(printf '%s' "$semantic_terms_json" | jq -ce '
    select(type == "array" and length <= 12 and all(.[]; type == "string"))
  ' 2>/dev/null) || {
    echo "❌ --semantic-terms-json 必须是最多 12 项的 JSON 字符串数组"
    exit 1
  }
  sales_code=$(product_sales_code "$product_type") || {
    echo "❌ product-type 非法，仅支持 aipay|webpay|apppay"
    exit 1
  }
  local cache_root
  cache_root="$(mcc_cache_root)" && "${NODE_BINARY:-node}" "$SCRIPT_DIR/mcc_cache.mjs" prune "$cache_root" "$(mcc_cache_ttl_seconds)" || true
  init_alipay_cli_product "$product_type" || exit 1

  if [ -n "$selection_receipt" ]; then
    catalog="$(read_mcc_selection_cache "$product_type" "$sales_code" "$selection_receipt" 2>/dev/null || true)"
    if [ -n "$catalog" ] && validate_mcc_selection_cache "$query" "$product_type" "$selection_receipt" "$catalog" "$semantic_terms_json"; then
      used_selection_cache=true
    else
      catalog=""
    fi
    [ "$used_selection_cache" = true ] || stale_selection=true
  fi

  if [ "$used_selection_cache" != true ]; then
    require_alipay_cli_local_state_access_or_emit || exit "$?"
    capture_or_exit tree get_mcc_tree "$product_type" "$sales_code"
    rows=$(printf '%s' "$tree" | mcc_rows_from_tree) || {
      mcc_query_failed
    }
    tree_catalog=$(normalize_mcc_tree_catalog "$rows") || {
      mcc_query_failed
    }
    tree_catalog_digest=$(printf '%s' "$tree_catalog" | "${NODE_BINARY:-node}" -e 'const fs=require("node:fs"),crypto=require("node:crypto"); process.stdout.write(crypto.createHash("sha256").update(fs.readFileSync(0)).digest("hex"));') || mcc_query_failed
    capture_or_exit resolution run_mcc_match_codes "$query" "$product_type" "$root_intent" "$tree_catalog" "$semantic_terms_json" "$agent_candidate_refs_json" "$input_id" "$tree_catalog_digest" "$agent_candidate_refs_provided"
    match_type=$(printf '%s' "$resolution" | jq -r '.matchType // ""' 2>/dev/null) || mcc_query_failed
    semantic_status=$(printf '%s' "$resolution" | jq -r '.semanticStatus // ""' 2>/dev/null) || mcc_query_failed
    agent_review_required=$(printf '%s' "$resolution" | jq -r '.agentReview.required // false' 2>/dev/null) || mcc_query_failed
    agent_repair_required=$(printf '%s' "$resolution" | jq -r '.agentRepair.required // false') || mcc_query_failed
    if [ "$agent_repair_required" = true ]; then
      agent_repair_payload=$(printf '%s' "$resolution" | jq -c '.agentRepair') || mcc_query_failed
      emit_control "MCC_QUERY_RESULT=SUCCESS"
      emit_control "MCC_AGENT_REPAIR_REQUIRED=$agent_repair_payload"
      return 0
    fi
    if [ "$agent_review_required" = true ]; then
      if [ "$agent_candidate_refs_provided" = false ] && mcc_input_cache review-start "$product_type" "$sales_code" "$input_id" "$query" "$semantic_terms_json" "$tree_catalog_digest"; then
        agent_review_payload=$(printf '%s' "$resolution" | jq -c '.agentReview') || mcc_query_failed
        emit_control "MCC_QUERY_RESULT=SUCCESS"
        emit_control "MCC_RESOLUTION=$(printf '%s' "$resolution" | jq -c 'del(.agentReview)')"
        emit_control "MCC_AGENT_REVIEW_REQUIRED=$agent_review_payload"
        return 0
      fi
      emit_control "MCC_MATCH_ERROR=AGENT_REVIEW_STATE_INVALID"
      mcc_query_failed
    fi
    if [ -z "$agent_candidate_refs_json" ] && [ "$match_type" = "NONE" ] \
      && [ "$semantic_status" != "DYNAMIC_CATALOG_CODE_NOT_FOUND" ] \
      && [ "$semantic_status" != "DYNAMIC_CATALOG_CODE_AMBIGUOUS" ]; then
      if [ -n "$input_id" ]; then
        next_retry_count="$(mcc_input_cache retry "$product_type" "$sales_code" "$input_id" "$query" "$semantic_terms_json" 2>/dev/null)"
        retry_rc=$?
      else
        # A retry without a message identity cannot be bound to one user input.
        # Keep the bounded retry contract closed instead of sharing a placeholder.
        retry_rc=2
      fi
      if [ "$retry_rc" -eq 0 ]; then
        if [ "$semantic_terms_json" = "[]" ]; then
          retry_reason="MISSING_SEMANTIC_TERMS"
        else
          retry_reason="NO_MATCH"
        fi
        retry_payload=$(jq -cn \
          --argjson attempt "$next_retry_count" \
          --argjson maxAttempts "$MCC_SEMANTIC_RETRY_LIMIT" \
          --argjson remainingAttempts "$((MCC_SEMANTIC_RETRY_LIMIT - next_retry_count))" \
          --arg reason "$retry_reason" \
          '{attempt: $attempt, maxAttempts: $maxAttempts, remainingAttempts: $remainingAttempts, reason: $reason}') \
          || mcc_query_failed
        emit_control "MCC_QUERY_RESULT=SUCCESS"
        emit_control "MCC_RESOLUTION=$resolution"
        emit_control "MCC_SEMANTIC_RETRY_REQUIRED=$retry_payload"
        return 0
      fi
    fi
    if [ "$match_type" = "NONE" ]; then
      catalog="$tree_catalog"
    else
      full_codes=$(printf '%s' "$resolution" | jq -c '.mergedCandidateCodes // []' 2>/dev/null) || mcc_query_failed
    fi
  if [ -z "${catalog:-}" ]; then
      if ! printf '%s' "$full_codes" | jq -e 'type == "array" and length > 0' >/dev/null 2>&1; then
        catalog="$tree_catalog"
      else
        candidate_rows=$(rows_for_full_codes "$rows" "$full_codes") || mcc_query_failed
        if ! printf '%s' "$candidate_rows" | jq -e 'type == "array" and length > 0' >/dev/null 2>&1; then
          mcc_query_failed
        fi
        qualification_rows=$(printf '%s' "$candidate_rows" | jq -c '[.[] | select(.treeNeedSpecialQual == true)]' 2>/dev/null) || mcc_query_failed
        if printf '%s' "$qualification_rows" | jq -e 'length > 0' >/dev/null 2>&1; then
          capture_or_exit details query_mcc_details "$qualification_rows"
        else
          details='null'
        fi
        catalog=$(normalize_mcc_catalog "$candidate_rows" "$details") || {
          mcc_query_failed
        }
      fi
    fi
  fi
  if [ -n "$agent_candidate_refs_json" ] && ! printf '%s' "$catalog" | jq -e \
    --argjson refs "$agent_candidate_refs_json" '
      ([.[] | .mccRef?] | map(select(type == "string"))) as $available |
      ($refs | type == "array" and all(.[]; . as $ref | $available | index($ref) != null))
    ' >/dev/null 2>&1; then
    # A directory mismatch cannot turn an explicit review into lexical fallback.
    mcc_query_failed
  fi
  node_args=(
    "$ONBOARDING_RUNNER" mcc-resolve-plan
    --query "$query"
    --product-type "$product_type"
    --root-intent "$root_intent"
    --mcc-catalog-json "$catalog"
    --semantic-terms-json "$semantic_terms_json"
  )
  if [ -n "$input_id" ]; then
    node_args+=(--input-id "$input_id")
  fi
  if [ -n "$agent_candidate_refs_json" ]; then
    node_args+=(--agent-candidate-refs-json "$agent_candidate_refs_json")
  fi
  if [ "$stale_selection" = true ]; then
    node_args+=(--selection-state STALE)
  elif [ -n "$select_value" ] || [ -n "$selection_receipt" ]; then
    if [ -z "$select_value" ] || [ -z "$selection_receipt" ]; then
      echo "❌ --select 与 --selection-receipt 必须同时提供"
      exit 1
    fi
    node_args+=(--select "$select_value" --selection-receipt "$selection_receipt")
  fi
  local output
  output="$(capture_mcc_runner "${node_args[@]}")" || mcc_query_failed
  if { [ -z "$selection_receipt" ] || [ "$stale_selection" = true ]; } \
    && [ -n "${candidate_rows:-}" ] && [ -n "${details:-}" ]; then
    local generated_selection_receipt
    generated_selection_receipt=$(printf '%s\n' "$output" | sed -n 's/^ALIPAY_AIPAY_INTERNAL:MCC_SELECTION_RECEIPT=//p')
    if [ "$(printf '%s\n' "$generated_selection_receipt" | sed '/^$/d' | wc -l | tr -d ' ')" = "1" ]; then
      write_mcc_selection_cache "$product_type" "$sales_code" "$generated_selection_receipt" "$catalog"
    fi
  fi
  emit_control "MCC_QUERY_RESULT=SUCCESS"
  printf '%s\n' "$output" | sed -n 's/^MCC_STDOUT://p'
  printf '%s\n' "$output" | sed -n '/^ALIPAY_AIPAY_INTERNAL:/p' >&2
}

case "${1:-}" in
  resolve-plan)
    run_resolve_plan "$@"
    ;;
  *)
    echo "用法: bash mcc.sh resolve-plan --query <经营描述|MCC编码> --product-type <aipay|webpay|apppay> --root-intent <onboarding_only|full_process> [--semantic-terms-json <JSON数组>] [--agent-candidate-refs-json <JSON数组>] [--select <MCC编码> --selection-receipt <receipt>] [--input-id <USER_INPUT_ID>]"
    exit 1
    ;;
esac
