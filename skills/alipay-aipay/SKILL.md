---
name: alipay-aipay
description: >-
  支付宝 AI 付接入 Skill。当用户选择完成 AI 按量付费、AI 网页应用收款、AI 移动应用收款三类支付宝收单产品的代码开发、产品开通或全流程同时完成两者时，使用此 Skill。
  触发关键词："AI支付"、"接支付宝"、"一站式接支付宝"、"接个支付"、"开发支付"、"402收款"、"AI按量付费"、"AI网页应用收款"、"AI移动应用收款"、"按量付费"、"快捷收款"、"快捷收单"、"网站支付"、"APP 支付"、"产品开通"、"商家开通"、"签约入驻"等。
---

# 支付宝 AI 付接入 Skill 启动器

本文件只负责在加载业务规则前确定本轮实际使用的 Skill 版本，并刷新本机 `alipay-cli`。禁止在完成下列启动协议前读取 `references/runtime-entry.md`、任一 flow、模块、消息目录或业务脚本。

## 前置启动协议

本次 Agent 对话首次使用 `alipay-aipay` 时，先把本文件所在目录解析为规范化绝对路径 `<SKILL_DIR>`，记录一次性事实 `ALIPAY_AIPAY_SELF_UPDATE_CHECKED=true`，再执行以下单条命令。`<SKILL_DIR>` 是执行时替换的路径占位符；禁止用 shell 变量赋值、命令替换或依赖特定 shell：

```text
node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" self-update check --skill-dir "<SKILL_DIR>"
```

`SKILL_DIR` 必须绑定刚触发且正在执行本命令的 Skill 规范化绝对路径，不得换成 Agent 启动目录、用户项目目录、用户 Home、npm 包源码根或另一份 Skill 副本。`VERSION` 缺失/非法或 `references/runtime-entry.md` 缺失时由本命令尝试精确修复；命令失败或 marker 无法唯一解析时按 `SELF_UPDATE:CHECK_FAILED`。

stderr 只允许出现以下一个内部终态；不得向用户展示 marker 或 npm/npx 原始输出：

- `SELF_UPDATE:UPDATED=<合法 SemVer>`：当前 Skill 目录已原子切换到新版。
- `SELF_UPDATE:CURRENT=<合法 SemVer>`：继续当前版本。
- `SELF_UPDATE:RETRY_WITH_NETWORK`：registry 或安装阶段网络不可达；可申请联网后原样重试本命令一次。
- `SELF_UPDATE:SKIPPED_NETWORK_RESTRICTED|CHECK_FAILED|INSTALL_FAILED|VERIFY_FAILED`：静默继续当前可用版本，不重试、不申请权限。

`UPDATED` 后先废弃旧 loaded 事实，禁止继续读取更新前版本的任何业务文档，后续命令使用新版同一 `SKILL_DIR`；其他终态继续当前可用版本，其他终态同样不再读取本启动器或 `self-update.md` 补充规则。

版本确定后，若当前上下文没有与规范化 `SKILL_DIR`、合法 `VERSION` 绑定的 `ALIPAY_AIPAY_CLI_REFRESHED=true`，必须刷新一次 `alipay-cli`；不得因自更新已检查而跳过。仅唯一终态 `READY` 可在当前对话上下文记录该成功事实、路径和版本，不写缓存或业务状态；三者仍可用且一致时，后续根触发、确认、补材料、候选选择、恢复、中断继续和 Full Process 衔接均不重复刷新。

```text
node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" env refresh-alipay-cli
```

stderr 只允许一个 `ALIPAY_AIPAY_INTERNAL:ALIPAY_CLI_REFRESH=<READY|RETRY_WITH_NETWORK|RETRY_WITH_LOCAL_FS_PERMISSION|FAILED|VERIFY_FAILED>`，stdout 必须为空，安装器及版本输出不得对客。前两种重试终态分别只允许取得网络权限或 `~/.local/bin` 写权限后原样重试一次；其他终态静默继续，并以之后环境检查和业务脚本的实际 CLI 可用性为准。路径或版本变化、上下文压缩导致事实不可用、用户明确要求刷新，或环境检查证明 CLI 缺失/损坏时清除旧事实并按同一预算重试；非 `READY` 不得循环。

完成本次所需刷新或命中成功事实后，只完整读取同一 `SKILL_DIR` 的 `references/runtime-entry.md`，在当前上下文记录 `ALIPAY_AIPAY_RUNTIME_ENTRY_LOADED=true` 和规范化路径，再按原请求路由。同一对话后续确认、补材料、候选选择、恢复、中断继续、重复触发和 Full Process 衔接，入口事实存在、路径未变且入口规则仍在时，跳过版本检查和入口重读。仅 `UPDATED`、路径变化或上下文压缩导致规则不可用时重读；事实不落盘。
