# 自更新

首次使用 `alipay-aipay` 前检查一次版本，记录 `ALIPAY_AIPAY_SELF_UPDATE_CHECKED=true`：`node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" self-update check --skill-dir "<SKILL_DIR>"`。`<SKILL_DIR>` 是当前包含 updater 的 Skill 规范化绝对路径，不得换成启动目录、项目目录、Home、npm 源码根或其他副本；命令不得改成变量赋值、命令替换、相对路径或特定 shell 语法；不透传 npm/npx 原始输出。

唯一 stderr 终态：`SELF_UPDATE:CURRENT=<合法 SemVer>`、`SELF_UPDATE:UPDATED=<合法 SemVer>`、`SELF_UPDATE:SESSION_READY=<合法 SemVer>`、`SELF_UPDATE:RETRY_WITH_NETWORK`、`SELF_UPDATE:SKIPPED_NETWORK_RESTRICTED`、`SELF_UPDATE:CHECK_FAILED`、`SELF_UPDATE:INSTALL_FAILED`、`SELF_UPDATE:VERIFY_FAILED`。`UPDATED` 用原子替换后的新版，除 `SESSION_READY` 外其余用当前可用版；marker 异常读当前入口，不得称最新或更新成功；停止读旧版，读取同一根目录的新版入口。仅 `RETRY_WITH_NETWORK` 可取权后原样重试一次，拒绝、不支持或再次返回时读当前入口；一次网络恢复外，不重查、取权、用 `sudo`、要求用户操作或写更新状态。每次只查一次 npm latest 的 `version` 和 `alipayAipayChannels`；只比较本渠道 Skill 版本，npm 包版本仅用于精确下载；`VERSION` 缺失、非法、落后或业务入口缺失时只从查询所得精确 npm 包版本安装当前渠道一次。渠道由当前目录的 `references/normal/json/release-channel.json` 与 Skill 名称共同校验；旧正式版缺少渠道文件时只兼容 `stable`，预发版禁止回退正式版。缺少或非法的远端渠道元数据返回 `CHECK_FAILED`，不得按 npm 包版本兜底。不调用公开 `install --target all`；超时终止同一次调用的进程树并清理。

公开 npm `install` 是 `PROFILE` 的唯一创建入口：`chinfo` 显式传值时更新为该来源，未传时更新为 `origin`；只有显式 `--vid <值>` 才新增或更新 `vid`，未传时保留已有 `vid`，其他已有扩展字段也保留。自更新只原样迁移当前 Skill 根目录已有的普通 `PROFILE`；不存在时新版及 Windows 会话副本都保持不存在。内部 `npx ... install-current` 不属于用户主动安装，禁止创建 `origin` 或修改 `vid`。源包的 `skill/` 与 `skill-pre/` 不包含 `PROFILE`。

本地正式渠道的 `X.Y.Z-beta`、`X.Y.Z-betaN`（兼容 `-beta.N`）和预发渠道的 `X.Y.Z-pre-beta`、`X.Y.Z-pre-betaN` 均为固定测试版本。完整安装直接返回 `CURRENT` 且不查询 npm；业务入口损坏时返回 `VERIFY_FAILED`，仍不下载修复或转正。更换版本必须由测试人员显式执行 npm 安装器的 `install`，普通 `update` 同样不推进 beta。正常版本分别为 `X.Y.Z` 与 `X.Y.Z-pre`，远端对应渠道若为 beta 或名称不匹配，返回 `CHECK_FAILED`，不自动安装。beta 不参与版本排序，无自动追踪和自动转正。

`SESSION_READY` 是 Windows 目录占用或权限失败的有限恢复：只有替换前的备份/暂存准备失败，安装器才从本次精确 npm 包创建并逐文件 SHA-256 复核独立副本；不混合覆盖原目录，不更新全局安装记录。必须同时取得唯一 `ALIPAY_AIPAY_INTERNAL:SELF_UPDATE_SESSION_SKILL_DIR=<JSON 字符串>`，用已核验的绝对路径重绑 `SKILL_DIR`，明确告知“全局目录未更新，当前会话使用已校验的新版本；下次会话仍可能加载旧版”。废弃旧 loaded/CLI 刷新事实，保留本渠道自更新已检查事实，立即读取新路径的 `SKILL.md` 并继续其余启动协议，禁止再次自更新。内测版仍需按新路径/版本完成声明及服务/采集选择，安装意图不得代替采集同意。路径 marker 缺失、冲突或新入口不可读时，不切换、不声称更新成功，使用仍可用的原目录或说明入口不可用。

手工 npm 安装/更新遇到同类 Windows 故障时，只有安装器返回唯一 `SKILL_SESSION_READY` 回执并给出已校验的新 `SKILL.md` 路径才可加载该副本；仍须说明全局未更新并执行新启动协议。副本位于用户目录 `.alipay-aipay/session-skills`，不在 Agent 自动发现目录内；不注册为全局版本、不扫描其他已安装副本、不在使用中自动删除。副本自更新验证本地内容后固定本次版本，后续全局更新仍需解除原目录占用/权限问题并重新安装。

Windows 自更新优先使用当前 Node 相邻的 npm/npx JS 入口，包管理器子进程 PATH 临时前置该 Node 目录；未发现配套模块时保留原 `.cmd` 入口。独立 Node 无需写入永久 PATH，非 Windows 仍使用原命令和环境。

显式多目标 `update --target all` 保留原失败语义，不生成多份可混淆的会话加载回执；会话副本恢复用于绑定当前目标的安装/更新。旧版 updater 不识别本协议时仍保留原目录，首次使用本恢复能力需经包含该修复的 npm 安装器加载新版。
