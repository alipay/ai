#!/bin/bash
# 智能识别 AI 编程工具
# 返回值：coze | meoo | claudeCode | codex | traeSolo | cursor | qoder | unknown

detect_dev_tool() {
    if [ -n "$COZE_PROJECT_ID" ]; then
        echo "coze"
        return
    fi
    if [ -n "$MEOO_PROJECT_ID" ]; then
        echo "meoo"
        return
    fi
    if [ -n "$CLAUDECODE" ] || [ -n "$CLAUDE_CODE_ENTRYPOINT" ]; then
        echo "claudeCode"
        return
    fi
    if [ -n "$CODEX_CI" ] || [ -n "$CODEX_THREAD_ID" ]; then
        echo "codex"
        return
    fi
    if [ -n "$TRAE_BRAND_NAME" ]; then
        echo "traeSolo"
        return
    fi
    if [ -n "$CURSOR_AGENT" ] || [ -n "$CURSOR_LAYOUT" ]; then
        echo "cursor"
        return
    fi
    if [ -n "$QODER_CLI" ]; then
        echo "qoder"
        return
    fi
    echo "unknown"
}

DEV_TOOL_NAME=$(detect_dev_tool)
echo "$DEV_TOOL_NAME"