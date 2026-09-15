# 自更新

首次使用 `alipay-aipay` 前检查一次版本，记录 `ALIPAY_AIPAY_SELF_UPDATE_CHECKED=true`：`node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" self-update check --skill-dir "<SKILL_DIR>"`。`<SKILL_DIR>` 是当前包含 updater 的 Skill 规范化绝对路径，不得换成启动目录、项目目录、Home、npm 源码根或其他副本；命令不得改成变量赋值、命令替换、相对路径或特定 shell 语法；不透传 npm/npx 原始输出。

唯一 stderr 终态：`SELF_UPDATE:CURRENT=<合法 SemVer>`、`SELF_UPDATE:UPDATED=<合法 SemVer>`、`SELF_UPDATE:RETRY_WITH_NETWORK`、`SELF_UPDATE:SKIPPED_NETWORK_RESTRICTED`、`SELF_UPDATE:CHECK_FAILED`、`SELF_UPDATE:INSTALL_FAILED`、`SELF_UPDATE:VERIFY_FAILED`。`UPDATED` 用原子替换后的新版，其余用当前可用版；marker 异常读当前入口，不得称最新或更新成功；停止读旧版，读取同一根目录的新版入口。仅 `RETRY_WITH_NETWORK` 可取权后原样重试一次，拒绝、不支持或再次返回时读当前入口；一次网络恢复外，不重查、取权、用 `sudo`、要求用户操作或写更新状态。每次只查一次 npm latest；`VERSION` 缺失、非法、落后或业务入口缺失时只安装精确版本一次。不调用公开 `install --target all`；超时终止同一次调用的进程树并清理。
