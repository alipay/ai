# 全局自更新与本地元数据

本 Skill 统一使用 `@alipay/alipay-aipay`、`alipay-aipay`，没有正式版/预发版选择。所有产品共用本机制。当前对话首次触发时，在 Agent 上下文先记下 `ALIPAY_AIPAY_SELF_UPDATE_CHECKED=true`，再执行一次：

```sh
node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" self-update check
```

检查绑定命令所在的规范化 Skill 目录；可选 `--skill-dir "<SKILL_DIR>"` 必须指向同一目录。补充回复、恢复、跨产品资料查询及重复读取不重新检查，不把该一次性事实写磁盘。一次查询 npm latest 包版本与兼容版本映射，随后只安装查询所得精确包版本，内部 `install-current` 只更新当前目录，不扫描或批量更新其他副本。beta 固定版本不查询 npm，换版需要显式 install。网络受限时不尝试联网。

唯一终态写 stderr：`SELF_UPDATE:CURRENT=<版本>`、`UPDATED=<版本>`、`SESSION_READY=<版本>`、`RETRY_WITH_NETWORK`、`SKIPPED_NETWORK_RESTRICTED`、`CHECK_FAILED`、`INSTALL_FAILED`、`VERIFY_FAILED`。内部行不作为对客正文。`UPDATED` 后停止读取旧资料，直接读取更新后的根启动器和运行入口，不再次自更新。只有 `RETRY_WITH_NETWORK` 在网络恢复后原样重试一次；其他失败继续仍可用的当前入口，不重复检查或循环安装。

Windows 在原目录切换前遇到 EPERM/EACCES/EBUSY 时，可在用户目录、Agent 自动发现路径外建立本次精确载荷的会话副本。只有 `SESSION_READY` 和唯一 `SELF_UPDATE_SESSION_SKILL_DIR` 且副本校验成功才能切换；说明全局目录未更新，绑定新路径重读入口，保留已检查事实。不改永久 PATH、不提权、不扫描其他安装。失败或回滚不明不作为副本成功。

## PROFILE

`SKILL.md` 同目录只使用 JSON `PROFILE` 保存 `version`、`chinfo`、可选 `vid` 和已有扩展字段。version 是 Skill 载荷版本；本次包与 Skill 均为 2.0.1。业务 CLI 与阶段遥测读取同一版本，不把来源字段塞入 stage 的 c4。

公开 `npx -y @alipay/alipay-aipay@latest install [--chinfo <来源>] [--vid <访问来源>]` 更新版本并刷新 chinfo：未传 chinfo 写 origin；未传 vid 保留原值。自更新、内部 install-current 只更新 version，保留 chinfo、vid 和扩展字段。字段合并与安装按同一目标加锁、原子替换；无效/损坏 PROFILE 保留原文件并停止覆盖，不静默丢弃来源。可变来源不参与不可变代码摘要，但版本必须与载荷收据一致。

旧用户可通过既有自更新直接升级。内部 `install-current` 先验证目标目录和事务 ID；新版 updater 额外传 `ALIPAY_AIPAY_UPDATER_PROTOCOL=2`，旧 updater 不传。仅内部调用未声明新版协议时，安装器暂留 VERSION=2.0.1，供已在运行的旧代码完成验收；公开 install 与新版内部协议均不生成 VERSION。首次执行新版 runtime 时验证 PROFILE、安装载荷及适用会话收据后移除 VERSION。Windows 旧格式会话收据先通过旧 verifier，再转换为新版收据；以后只有 PROFILE。失败时保留证据，不提前删除 VERSION。

## 发布渠道扩展边界

保留 `package.json.alipayAipayChannels.stable` 和载荷的 `release-channel.json`，当前只提供 stable 这一套载荷。映射同时供旧 updater 查询，并为未来增加内测版保留配置位置。添加新 key 不会自动启用新渠道；届时需明确独立载荷与身份、安装目标、版本规则、自更新隔离和用户选择，再扩展对应运行入口。目前不新增渠道参数或切换提示。
