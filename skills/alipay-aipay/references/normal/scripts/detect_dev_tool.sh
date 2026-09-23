#!/bin/bash
#=============================================================================
# 脚本名称: detect_dev_tool.sh
# 功能描述: 智能识别 AI 编程工具，返回工具名称
# 调用位置: 集成流程和签约流程的环境检查
# 调用前置: 无
# 返回值: 已识别工具名 | gateway 规范化的 Agent 宿主兜底 | unknown
#=============================================================================

detect_dev_tool() {
    local script_dir
    script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

    # The gateway supplies a normalized value; direct legacy callers are normalized here too.
    local agent_platform
    agent_platform="$(node "$script_dir/agent_platform.mjs" normalize "${ALIPAY_AIPAY_AGENT_PLATFORM:-}" 2>/dev/null || true)"
    if [ -n "$agent_platform" ] && [ "$agent_platform" != "unknown" ]; then
        echo "$agent_platform"
        return
    fi
    if [ -n "${CLAUDE_CODE_SESSION_ID:-}" ] || [ -n "${CLAUDE_SESSION_ID:-}" ] \
        || [ -n "${CLAUDECODE:-}" ] || [ -n "${CLAUDE_CODE_ENTRYPOINT:-}" ]; then
        echo "claudecode"
        return
    fi
    if [ -n "${OPENCLAW_SESSION_ID:-}" ] || [ -n "${OPENCLAW_AGENT_ID:-}" ]; then
        echo "openclaw"
        return
    fi
    if [ -n "${CURSOR_TRACE_ID:-}" ] || [ -n "${CURSOR_SESSION_ID:-}" ] \
        || [ -n "${CURSOR_AGENT:-}" ] || [ -n "${CURSOR_LAYOUT:-}" ]; then
        echo "cursor"
        return
    fi
    if [ -n "${COZE_PROJECT_ID:-}" ] || [ -n "${COZE_SESSION_ID:-}" ] \
        || [ -n "${COZE_CONVERSATION_ID:-}" ]; then
        echo "coze"
        return
    fi
    if [ -n "${MEOO_PROJECT_ID:-}" ]; then
        echo "meoo"
        return
    fi
    if [ -n "${MIAODA:-}" ]; then
        echo "miaoda"
        return
    fi
    if [ -n "${CODEX_CI:-}" ] || [ -n "${CODEX_THREAD_ID:-}" ] \
        || [ -n "${CODEX_SESSION_ID:-}" ] || [ "${CODEX_SANDBOX_NETWORK_DISABLED+x}" = x ]; then
        echo "codex"
        return
    fi
    if [ -n "${TRAE_BRAND_NAME:-}" ]; then
        echo "traesolo"
        return
    fi
    if [ -n "${QODER_CLI:-}" ]; then
        echo "qoder"
        return
    fi

    local key candidate normalized
    for key in ALIPAY_AIPAY_PLATFORM AIPAY_AGENT_TYPE DEV_TOOL_NAME PLATFORM; do
        candidate="${!key:-}"
        [ -n "$candidate" ] || continue
        normalized="$(node "$script_dir/agent_platform.mjs" normalize "$candidate" 2>/dev/null || true)"
        if [ -n "$normalized" ] && [ "$normalized" != "unknown" ]; then
            echo "$normalized"
            return
        fi
    done
    echo "unknown"
}

# 仅在直接执行时输出，被 source 时不执行
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    DEV_TOOL_NAME=$(detect_dev_tool)
    echo "$DEV_TOOL_NAME"
fi
