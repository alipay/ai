# Alipay CLI 环境准备

> 本文档定义 alipay-cli 的检测、安装、验证规范，供集成流程和签约流程统一引用。

---

## 1. CLI 检测

### 1.0 对话首次成功刷新

本次 Agent 对话首次使用 `alipay-aipay` Skill 时，版本确定后按根 `SKILL.md` 执行一次：

```bash
node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" env refresh-alipay-cli
```

该动作把目标刷新到 `~/.local/bin`，不携带 `PLATFORM`、`PRODUCT` 或 `ALIPAYCLI_BIZ_INFO`。成功事实、内部 marker、重试预算和同对话复用均以根启动协议为准；失败不证明 CLI 可用，仍由本章检测和业务脚本按实际结果处理。

### 1.1 检测命令

```bash
# 推荐：一步检测
which alipay-cli 2>/dev/null && alipay-cli version
```

### 1.2 检测时机

**必须在以下操作前执行 CLI 检测：**
- 执行 `whoami` 检查登录状态前
- 执行 `login` 登录授权前
- 执行任何 MCP 调用前
- 执行沙箱创建操作前

---

## 2. 沙箱化 Agent 网络权限规则

在存在网络沙箱或命令审批机制的 Agent 环境中，默认命令可能运行在无外网的受限沙箱内。`alipay-cli` 访问支付宝服务必须联网，若先在受限沙箱内执行，容易出现“网络连接失败”后再重试的差体验。

**应按联网命令处理的命令：**
- `alipay-cli login`、`alipay-cli whoami`、`alipay-cli logout`
- `alipay-cli mcp call ...`
- `alipay-cli file upload ...`
- `node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" env refresh-alipay-cli`
- `export ALIPAY_CLI_BIN="$HOME/.local/bin" && curl -fsSL https://opengw.alipay.com/alipaycli/install | ALIPAY_CLI_SKIP_VERIFY=true bash`
- 按量付费沙箱测试中会访问用户服务或沙箱收银接口的 `local_402_sandbox_pay.py`

**执行要求：**
- 对已知需要联网的命令，如果当前 Agent 环境网络受限且支持显式授权，应首次执行即申请可联网权限，不要先在受限沙箱内试跑。
- 若命令已经因网络失败，重试时必须复用同一条命令并申请可联网权限；不要把该失败解释为用户网络故障。
- `auth.sh init|confirm|mismatch` 返回 `AUTH_FLOW:RETRY_WITH_NETWORK`：当前环境未取得可确认 CLI 结果；取联网权限后重试同一完整命令，不得解释为业务或 login/logout 失败，也不得改为用户手工操作。
- `auth.sh init|wait|confirm|mismatch` 返回 `AUTH_FLOW:RETRY_WITH_LOCAL_FS_PERMISSION`：仅缺 CLI 状态目录权限。允许同一 runtime 命令访问 `$HOME/.alipay-cli/credentials`、`${XDG_DATA_HOME:-$HOME/.local/share}/alipay-cli/logs` 后原样重试一次；仅供 CLI 使用，Agent 禁止读取、列举、打印或复制已有内容，不改变其他脚本边界。
- 签约、服务、应用、截图上传及匿名沙箱创建等受控 runtime 动作同样属于“联网 + CLI 私有状态读写”命令。脚本在参数和上下文校验后、首次 `alipay-cli` 调用前，对上述两个目录执行私有随机文件的创建、固定内容写入、同目录 rename 和删除探测；同一 Shell 进程后续分页、轮询或写后核验不重复探测，不读取、列举或改动任何已有凭据和日志。
- 非 auth 动作在 CLI 调用前探测失败时只输出 `CLI_FLOW:RETRY_WITH_LOCAL_FS_PERMISSION`，本次 CLI 调用次数为 0；允许当前同一 runtime 命令访问两个目录后原样重试一次。discovery 将其收口为唯一 `DISCOVERY_FLOW:RETRY_WITH_LOCAL_FS_PERMISSION`。拒绝、不支持或重试仍命中同一 marker 时停止申请，按当前 flow 的既有分支失败或待配置边界继续，不新增业务确认或普通对客文案。
- CLI 已执行后才出现本地状态权限证据时，只读动作仍可按上述 marker 原样重试一次；写动作一律视为 `MAYBE_SENT`，只走现有查询核验或 `UNKNOWN`，不得输出本地权限重试 marker、不得重放原写请求。stdout 成功 JSON 与 stderr 本地权限强证据冲突时仍按本规则阻断。
- `app.sh reuse|verify-key|verify-key-and-audit|audit` 已取得 RSA2 支付宝公钥但 `${XDG_CONFIG_HOME:-$HOME/.config}` 探测失败时，返回 `APP_FLOW:RETRY_WITH_LOCAL_CONFIG_PERMISSION` 和 `ALIPAY_PUBLIC_KEY_EXPORT_STATUS=RETRY_WITH_LOCAL_CONFIG_PERMISSION`。仅允许同一 runtime 命令访问该目录后原样重试一次，用于写 `<appId>-alipayPublicKey.keytext`；Agent 禁止检查已有文件。仍失败按目录文案收口。
- 本地纯解析、文件检查、`bash -n`、`jq` 校验等不联网命令仍可在默认沙箱内执行。

**减少重复授权：**
- 优先使用 runtime 的 `auth|app|service` 动作，避免展开 `alipay-cli mcp call`。持久授权范围使用当前 Skill 绝对路径的稳定命令前缀，不得换副本。
- 不用 `DEV_TOOL_NAME=<tool>`、`PLATFORM=<tool>` 等环境变量前缀；公共初始化会设置。从业务入口的首条 bootstrap/start-run 起，Agent 依照入口协议随每条 runtime 命令追加 `--agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"`，作为当前命令的首选宿主名称；该值无效或为 `unknown` 时才回退自动识别。产品上下文用 `--sales-code`、`--mcc-code`、`--product-type` 等脚本参数。
- 只有脚本未覆盖的临时排查命令，才直接调用 `alipay-cli`；这类命令需要按具体前缀单独授权。

---

## 3. 前置依赖：用户级 jq

当前官方 alipay-cli 安装脚本直接下载对应平台二进制，不依赖 GPG/PGP。Skill 不检测、安装或记录 GPG，也不设置跳过 PGP 的环境变量；当前安装命令继续使用 `ALIPAY_CLI_SKIP_VERIFY=true`。

签约与 Unix/macOS/Linux 快速沙箱仍需 jq，手工验证命令为：

```bash
jq --version
```

自动检测与恢复顺序固定如下：

1. `env check|integration-check` 先使用 PATH 中已有且能通过实际 filter 的 jq；受控 Shell 发现可执行的 `~/.local/bin/jq` 或 `~/.local/bin/alipay-cli` 时把该目录追加到 PATH，因此有效系统 jq 仍优先。若 PATH 前方 jq 能启动但无法执行实际 filter，而用户级 jq 验证通过，则当前受控 Shell 改用用户级 jq，避免恢复后仍被损坏的 PATH 项遮蔽。
2. 缺 jq 时，当前 flow 只执行一次 `node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" env prepare-jq --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"`。该动作需要访问 GitHub，并需要对 `~/.local/bin` 创建、写入和 rename；宿主支持权限申请时，只为同一条受控命令取得这些权限，不新增业务确认。
3. macOS/Linux `x64|arm64` 只从固定官方 GitHub 资产下载 jq 1.7.1，在 60 秒总预算内校验固定 SHA-256，并于私有临时文件验证精确版本和实际 JSON filter 后，以 `0755` 原子写入 `~/.local/bin/jq`。成功后原样重跑环境检查。
4. `JQ_PREPARE=FAILED|UNSUPPORTED`，或返回 `READY` 后重跑环境检查仍缺 jq，表示 GitHub 下载、校验、执行或落盘链路未使 jq 可用。此时由 Agent 执行一个当前系统首选包管理器兜底：macOS 优先清华 Homebrew bottle 镜像，Debian/Ubuntu 使用 apt，CentOS/RHEL 使用 yum；执行后必须同时通过 `jq --version` 和环境检查的实际 filter 验证。macOS 首选镜像明确失败后，才按阿里云、中科大、直连顺序选择下一条，不并发、不回到 `prepare-jq` 循环。Linux 包管理器可能需要宿主系统权限，该权限只属于兜底安装，不改变 Skill 用户目录写入边界，也不构成业务确认。

首次 `npx ... install` 与 Skill 环境恢复复用同一个资产清单和安装器。首次安装缺 jq 时只启动 detached 后台任务，不等待下载结果；失败会清理探测/临时文件，不阻塞 Skill、不写系统目录、不请求 sudo。其他架构不自动下载，`--with-jq` 仅兼容旧命令。

以下是 GitHub 用户级安装失败后的 Agent/手工兜底命令；首次 `npx ... install` 和 detached 后台任务不得自动调用：

| 系统/来源 | 完整命令 |
|---|---|
| macOS 清华 bottle（首选） | `env HOMEBREW_BOTTLE_DOMAIN="https://mirrors.tuna.tsinghua.edu.cn/homebrew-bottles" HOMEBREW_NO_AUTO_UPDATE=1 HOMEBREW_NO_INSTALL_CLEANUP=1 brew install jq` |
| macOS 阿里云 bottle | `env HOMEBREW_BOTTLE_DOMAIN="https://mirrors.aliyun.com/homebrew-bottles" HOMEBREW_NO_AUTO_UPDATE=1 HOMEBREW_NO_INSTALL_CLEANUP=1 brew install jq` |
| macOS 中科大 bottle | `env HOMEBREW_BOTTLE_DOMAIN="https://mirrors.ustc.edu.cn/homebrew-bottles" HOMEBREW_NO_AUTO_UPDATE=1 HOMEBREW_NO_INSTALL_CLEANUP=1 brew install jq` |
| macOS 直连（最后） | `env HOMEBREW_NO_AUTO_UPDATE=1 HOMEBREW_NO_INSTALL_CLEANUP=1 brew install jq` |
| Linux (Debian/Ubuntu) | `sudo apt-get update && sudo apt-get install -y jq` |
| Linux (CentOS/RHEL) | `sudo yum install -y jq` |

Windows Integration 的 Node runner 路径只要求 Node，不以 Bash、jq 或 alipay-cli 阻断 Step 1；进入产品开通或既有 shell/CLI 脚本时仍按 flow 补齐依赖。其他系统和 Onboarding 的检查边界不变。

---

## 4. CLI 安装

### 4.1 自动安装

`npx -y @alipay/alipay-aipay@latest install` 的后台准备任务会把 alipay-cli 安装到用户目录 `~/.local/bin`，无需 sudo。正常 Skill 触发已通过 `env refresh-alipay-cli` 自动刷新到同一目标目录；手动兜底时使用：

```bash
mkdir -p ~/.local/bin
export ALIPAY_CLI_BIN="$HOME/.local/bin" && curl -fsSL https://opengw.alipay.com/alipaycli/install | ALIPAY_CLI_SKIP_VERIFY=true bash
```

### 4.2 PATH 处理

如果安装成功后 `alipay-cli version` 仍提示 `command not found`，优先把 `~/.local/bin` 加入 PATH：
```bash
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
```

> ⚠️ 不要引导用户用 sudo 安装 alipay-cli 或修改系统目录权限。当前 Skill 的安装器通过 `ALIPAY_CLI_BIN="$HOME/.local/bin"` 规避 sudo；如用户环境无法写入 `~/.local/bin`，应让用户指定其他可写目录给 `ALIPAY_CLI_BIN`。

### 4.3 安装验证

安装后执行以下命令确认安装成功：
```bash
alipay-cli version
```

若提示 `command not found`，尝试以下方案：
```bash
# 方案一：刷新 PATH
source ~/.zshrc   # macOS zsh
source ~/.bashrc  # Linux/bash

# 方案二：使用绝对路径
~/.local/bin/alipay-cli version
```

---

## 5. 环境检测结果不透出规范

> ⚠️ **强制规范：检测结果仅供内部使用，禁止向用户输出！**

AI 工具由 `scripts/detect_dev_tool.sh` 检测；`init_alipay_cli_context` 设置 `DEV_TOOL_NAME`、`PLATFORM`，把当前 `run_id` 作为 `PLATFORM_ID`（不受遥测开关影响），并从当前生效 Skill 的 `VERSION` 和同源 `machineUserID` 动态生成 `ALIPAYCLI_BIZ_INFO={"skill":"alipay-aipay","skill_version":"v<当前 VERSION>","skill_user_id":"machine_<32位匿名机器哈希>"}`；极端环境无法取得合法 `machine_` 标识时只省略 `skill_user_id`，不写 `anonymous_uid` 且不阻断业务调用。所有携带 `PLATFORM` 的 Skill 业务 CLI 调用均携带该 JSON，外部同名值会被覆盖；`alipay-cli version` 等不携带 `PLATFORM` 的安装和环境探测不注入该变量。产品确认后，Onboarding 还严格映射 `aipay|webpay|apppay` 为 `PRODUCT=AIPAY|WEBPAY|APPPAY`，其环境检查、登录、查询、写入和上传均携带该值，但 `PRODUCT` 和 `ALIPAYCLI_BIZ_INFO` 都不写入 MCP JSON；Integration 产品确定前的环境检查和快速沙箱不传 `PRODUCT`。新建 run 优先采用宿主 `COZE_PROJECT_ID`、`MEOO_PROJECT_ID` 或 MIAODA 的 `VITE_APP_ID`/`PLATFORM_ID`，并复用为 `PLATFORM_ID`。

```
❌ 禁止：向用户输出"环境检查完成，检测到您正在使用 Claude Code 环境"等检测结果
❌ 禁止：向用户透出任何关于 AI 编程工具检测的信息
✅ 正确：检测结果仅供内部使用，只用于脚本设置 `PLATFORM`；`PLATFORM_ID` 由脚本从当前 `run_id` 派生，`ALIPAYCLI_BIZ_INFO` 由当前 Skill 版本和匿名 `skill_user_id` 派生，Onboarding 的 `PRODUCT` 由已确认产品映射
✅ 正确：静默完成检测，直接进入下一步流程
```

### 5.1 页面打开与下载能力降级

- HTTPS 白名单通过后依次尝试 macOS `open`→`osascript open location`，或 Linux/Unix `xdg-open`→`gio open`→`sensible-browser`；Windows 保留 PowerShell。仅返回 `OPENED|OPEN_FAILED|GUI_UNAVAILABLE|LINK_ONLY`。
- 系统 opener 失败时，宿主内置浏览器可用则打开已校验、已交付的同一 URL 一次，不搜索、改写或自动操作；仍失败才提示手动打开/保留复制兜底，再有限轮询。不得安装工具或绕过审批；`OPEN_ERROR_KIND|OPEN_ERROR_CODE` 仅内部诊断，不算业务失败。
- 目标应用缺少用户已准备的应用公钥时，macOS/Windows 直接执行 onboarding 的 `download_key_tool.sh`，默认保存到用户 `Downloads` 目录并展示实际安装包路径；Linux、缺少 `curl`/`node`、目录不可用、下载源不可达或下载校验失败均回退 `https://opendocs.alipay.com/isv/02kipk`。脚本 stdout 直接输出标准对客文案，不输出 `DOWNLOADED`、`PATH=`、`DOWNLOAD_FAILED` 或 `DOWNLOAD_REASON` 机器标记。下载不安装、不启动、不生成密钥，Skill 不另询问是否下载。
- 页面打开和下载能力检测不改变 alipay-cli、MCP、业务确认或网络重试契约；宿主权限提示不是 Skill 业务确认。

---

## 6. 错误处理

| 错误场景 | 处理方式 |
|----------|----------|
| CLI 不存在 | 后台自动安装到 `~/.local/bin` |
| 安装目录不可写 | 提示设置 `ALIPAY_CLI_BIN` 到其他可写目录后手动安装 |
| 安装后找不到命令 | 提示将 `~/.local/bin` 加入 PATH 或使用绝对路径 |
| 版本过旧 | 提示更新 CLI |
