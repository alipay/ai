# 登录授权业务语义

本模块只解释授权业务语义。运行时命令、确认、终态和失败分支以 `../flow.md` 为准；参数校验、URL 构造、状态保护和解析由 `scripts/auth.sh` 实现。正常路径不预读本模块。

## 产品授权范围

| 产品 | salesCode | scope |
| --- | --- | --- |
| AI 按量付费 | `I1080300001000160457` | `app:all,machine_pay:write,agmnt:write` |
| AI 网页应用收款 | `I1080300001000041203` | `app:all,fast_instant_trade_pay:write` |
| AI 移动应用收款 | `I1080300001000041313` | `app:all,auth_alipay_apppay:write` |

产品名称、salesCode、scope 和 MCC 必须属于同一本轮动态上下文。MCC 必须携带 `mcc.sh resolve-plan` 输出且绑定当前 run 的 `MCC_CONTEXT_RECEIPT`，回执内产品、salesCode、MCC 编码和名称须与授权参数逐项一致；跨 run 或缺失回执都在任何 `whoami`、`login`、`login --complete`、`logout` 或 opener 前停止，不读取静态 MCC 表兜底。

固定上下文通过后，`auth.sh` 按 salesCode 将 CLI `PRODUCT` 设置为 `AIPAY|WEBPAY|APPPAY`；该值只作为 CLI 上报上下文，不进入授权或签约 MCP 请求 JSON。

## 授权状态语义

- `AUTH_FLOW:SKIP|AUTH_SUCCESS`：当前本机登录态、scope 和当前 MCC 上下文均已通过脚本校验。
- `AUTH_FLOW:READY_TO_OPEN`：当前授权页已生成并完成白名单及上下文校验，可以交付页面后调用受控 opener。
- `AUTH_STATE:SAVE_FAILED`：授权页 stdout 已经安全生成并交付，但本地短时状态文件未能保存；不得重新生成页面，后续 opener 只能降级为 `AUTH_OPEN:LINK_ONLY`，`wait|confirm` 仍使用 flow 登记命令的显式上下文。
- `AUTH_FLOW:PENDING`：有限轮询耗尽或单次恢复查询尚未得到有效本机登录态；不等于失败，也不证明用户未扫码。
- `AUTH_FLOW:EXPIRED`：当前页面实际返回过期，旧页面和旧回复失效，重新执行 flow 登记的 init。
- `AUTH_FLOW:SCOPE_MISMATCH|MCC_MISMATCH`：只能走 `auth.sh mismatch`。统一 runtime 的 `auth init` 在底层 init 唯一返回 mismatch 且 stdout 为空时，会在同一命令内自动调用既有 `auth.sh mismatch`，抑制中间 mismatch 终态并只透传最终结果；`wait|confirm` 返回 mismatch 时仍按 flow 显式调用 mismatch。logout 后置条件未成立前不得重授权；仍登录返回 `AUTH_FLOW:LOGOUT_STILL_LOGGED_IN`。
- `AUTH_FLOW:AUTH_REQUIRED`：`whoami` 或已认证资源校验已证明当前 CLI 会话失效，且脚本已完成既有 logout 后置条件处理；按 flow 原样重新执行当前上下文的 `auth init` 一次，旧授权页不再作为恢复依据，再次命中时停止循环。
- `AUTH_FLOW:RETRY_WITH_NETWORK`：当前 Agent 环境无法确认结果，申请联网权限后原样重试同一命令；不得解释为用户本机登录失败。
- `AUTH_FLOW:RETRY_WITH_LOCAL_FS_PERMISSION`：授权状态命令 preflight 失败，或实际输出命中 CLI 私有状态写失败证据。可恢复阶段 stdout 为空；仅允许当前受控 runtime 命令访问 CLI 私有状态目录后原样重试一次；`wait|confirm` 保留短时授权状态，不重建授权页。Agent 禁止读取、列举、打印或复制已有凭据与日志；拒绝、不支持或重试仍命中同一 marker 时才输出最小失败说明。

CLI `login --complete` 成功只表示页面侧确认完成，不代表本机已取得可用登录态。返回成功但状态字段不在白名单时，脚本先用 `whoami` 复核：有效登录继续 scope/MCC 校验，仍未形成登录态则保持 `PENDING`，不可确认则 `RETRY_WITH_NETWORK`。脚本仍需复核 `whoami`、scope，并以固定授权 URL 绑定 MCC；动态 MCC 还需复核 `MCC_CONTEXT_RECEIPT`。当前后端查询没有权威 MCC 返回字段，禁止声称做了响应 MCC 等值比较。

## 页面与恢复

授权页只允许 `https://aipay.alipay.com/cli-auth`，必含唯一 `deviceCode/productCode/mccCode`，只允许可选 `platform`；`mccContextReceipt` 只用于本地上下文校验和短时状态，不进入授权 URL。禁止 CLI `verification_url`、额外参数、重复参数和 fragment。页面 stdout 必须先作为独立对客消息送达，再执行 `auth.sh open` 和 `auth.sh wait`，后续 pending 或收口不得合并进同一回复。

`wait` 生产最多查询 12 次，未成功的相邻查询间隔 5 秒，成功或过期立即停止。耗尽后按 flow 登记命令把用户原始回复和当前 `USER_INPUT_ID` 交给统一 runtime 的 `onboarding-recovery auth-confirm`；runner 复用统一肯定语义判定器并对该用户消息幂等计数，接受 `继续`、`好了`、`已完成`、`确认`、`OK` 和兼容输入 `1`，每次接受只执行一次 `auth.sh confirm`，不重启自动轮询。否定、疑问、取消、修改意见或含糊输入不查询。

授权对客正文只由 `auth.sh` 调用消息目录生成。初始页面不得提前要求回复完成；pending 的自然语言提示、允许回复和授权页返回提示都不在本模块维护副本。

## 状态保护

短时授权上下文使用当前用户私有临时目录和 `0600` 原子文件，拒绝符号链接。状态可见时显式参数必须逐项一致；状态不可见时仅允许完整显式上下文降级。新 init 只有先通过固定上下文校验才可替换旧状态；上下文改变且 CLI 仍登录时必须进入 mismatch，不得复用旧 deviceCode。

任何授权 token、deviceCode、未脱敏 CLI/MCP 输出和临时 URL 都不得进入普通日志、对话摘要、跨会话状态或宽权限临时文件。只有经过脚本白名单和当前上下文校验、且当前动作必须交付的授权 URL 可以进入该动作唯一对客正文。
