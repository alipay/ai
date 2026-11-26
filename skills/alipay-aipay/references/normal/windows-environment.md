# Windows 兼容环境

仅真实 Windows 加载本层。当前适配要求实际运行的 Windows x64 Node >=18.17；不通过 OS build 或系统原生架构探测推定能力，不承诺 ARM64、x86 或 WSL。当前移植依据是 Windows 工程验证交付包，尚不能宣称 Windows 10、干净安装或全部真实业务分支已验收。

只校验当前 Node 进程报告的 `platform=win32`、`arch=x64`、版本与实际可执行性；Git Bash、jq、CLI 仍各自通过实际启动和功能检查。非 x64 Node 走既有 LEGACY，系统信息查询失败不再额外阻断可运行的工具。Node 引导复用或安装 x64 Node 后也以实际启动验证为准。

Windows 原生 Node 调度明确选定的 Git for Windows Bash，原 Shell 脚本使用 Windows 原生 jq 与 alipay-cli。兼容层处理依赖、路径和进程；产品映射、CLI/MCP 命令、请求、业务确认、失败恢复和完成条件仍以真实 flow 和原脚本为准。Windows 的 Integration 继续由当前 Agent 串行执行，不启用 Worker。

## 已安装 Skill 的 Node 启动

当前会话已有验证过的 Node 绝对路径时直接复用。尚未绑定时，先通过宿主进程参数调用 PATH 中的 `node.exe`；若已知本机安装位置，也可用其绝对路径运行同一只读探测。

```text
node.exe -p "JSON.stringify({version:process.versions.node,platform:process.platform,arch:process.arch,executable:process.execPath})"
```

退出码为 0、stdout 只有一个 JSON 对象，且 `platform=win32`、`arch=x64`、`version` 是有效的 Node 版本号且至少为 18.17.0 时，核对 `executable` 为本机普通文件的规范化绝对路径。校验通过即绑定该路径，直接执行根入口的自更新检查。直接探测未找到合格 Node 时，再用系统 PowerShell 查找常见安装目录及此前准备的用户级 Node：

```text
powershell.exe -NoProfile -NonInteractive -File "<SKILL_DIR>/references/normal/scripts/windows/bootstrap-node.ps1" -Mode check
```

退出 0 且 stderr 中有唯一的 `ALIPAY_AIPAY_INTERNAL:NODE_BOOTSTRAP=<JSON>` 时，核对 `status=READY`、`version` 至少为 18.17.0、`nodePath` 为本机普通文件的规范化绝对路径，然后绑定该路径。后续所有 `node` 命令沿用已绑定的解释器和原参数；在 PowerShell 中写作 `& "<NODE_EXE>" "<SKILL_DIR>/references/normal/scripts/runtime.mjs" ...`。同一会话保留已有的采集选择与任务进度。

如果系统策略禁止运行 `.ps1`，引导可能还没开始就被拦截。保持现有执行策略，请用户提供符合条件的 `node.exe` 绝对路径，或按组织流程准备官方 Node 并重新打开宿主，再做上述直接探测。只读咨询可继续按根入口的采集说明和资料处理。

若引导已运行并返回 `NEEDS_SETUP`，已明确的三款收单执行任务默认允许用同一引导的 `-Mode prepare` 自动准备用户级 Node，无需另问是否安装；用户明确拒绝安装时不执行。只读问答不自动安装，其他产品沿用各自准备授权。本次加载失败且原因已恢复后，最多再用 `-Mode repair` 重试一次。只有需要同时检查配套的 npm 和 npx 时，才给引导加 `-RequireNpm`。

首次通过 npm/npx 获取这个包，需要已有可运行的 Node 和配套 npm/npx。在 Windows PowerShell 下可以用 `npx.cmd` 调用安装器。Skill 已落盘后，运行 JavaScript 使用绑定的 Node；各项开发和开通任务再检查各自所需的工具。

## 启动与分流

根入口已确定执行任务、具体产品和唯一 SESSION_ID，并取得本次服务选择。使用根入口选定的 Windows Node 绝对路径执行下列命令，书写为 node。三个收单产品及 TokenPay 周期订阅的公共沙箱任务共用此环境检查；周期订阅不进入收单开通流程。

```text
node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" windows-entry --root-intent "<ROOT_INTENT>" --product-type "<PRODUCT_TYPE>" --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"
```

本层是 Skill 公共环境能力，只报告实际本地能力，不枚举产品或选择其官网流程。产品入口决定是否自动准备和如何消费失败结果：当前网页收款、APP 收款、按量付费在开发、开通或完整接入任务明确后，默认自动准备缺失或不可用的用户级依赖，不另问是否安装，不展示正式版/内测版选择；健康依赖直接复用。用户明确拒绝安装时附加 `--prepare-authorized false`，明确选择站点时附加 `--site-selected true`。周期订阅本次保留原有准备授权与沙箱行为；未来产品通过各自入口接入，不将收单兜底写进公共依赖安装器。准备依赖不包含登录、签约或应用写入授权。

退出 0 只表示分流完成。必须取得唯一 `ALIPAY_AIPAY_INTERNAL:WINDOWS_ROUTE=<JSON>`，校验结果为 JSON 对象、rootIntent 等于当前任务、route 为 READY、BLOCKED、LEGACY 或 CODE_ONLY；非零、超时、缺失或冲突均按 BLOCKED 停止。READY 才执行本地快速沙箱和签约；BLOCKED 说明内部 `WINDOWS_ENV_RESULT` 的实际 reason/dependency 及恢复动作，等待环境修复，不能输出站点引导；LEGACY 仅用于不支持的执行映射或用户明确选择站点。后续 Windows runtime 命令附加当前 `--windows-route`；BLOCKED 不进入 bootstrap、业务 flow 或项目写入。CODE_ONLY 表示可继续不依赖失败工具的原生开发，产品是否支持官网兜底由其入口决定，任务和诊断原因沿用本次入口事实。修复可选工具后重新只读复检，取得唯一 READY 才恢复快速沙箱和开通动作。环境故障不关闭遥测，也不改变 SESSION_ID、run_id、计数或会话采集选择。

三种根意图遇到已识别的 Git Bash、jq、CLI 或安装辅助工具缺失/运行失败，以及这些工具的有限安装、下载、哈希/签名校验失败时，返回 `CODE_ONLY`。失败工具不得继续执行，校验失败的安装包不得运行。以唯一 WINDOWS_ROUTE 的 route 决定是否进入开发；WINDOWS_ENV_RESULT 的失败诊断保留实际原因，不能将其误读为业务能力可用。该分流沿用 Integration 的原生 Node 路径，沙箱默认 `VERIFY_PENDING`，跳过快速沙箱；用户主动提供完整有效手工资料并写入、校验项目配置后，可记沙箱 `READY`，无需先将环境分流恢复为 READY。各测试按自身实际依赖执行：缺失工具所依赖的动作仍不能运行；原生 Python 402 联调不依赖 Git Bash，但仍须 Python、curl、服务可访问、沙箱配置等前置就绪。最终如实列出未完成项。三款收单产品：单独开通时由平台入口直接交付官网指引；完整接入通过原开发 checklist 和交接校验后，交付同一官网指引。两者都禁止在 CODE_ONLY 下执行本地授权、查询、材料上传或写入，官网引导不等于开通成功，也不补报尚未发生的成功 stage。独立代码开发不额外引导开通。其他产品沿用其自身失败处理。Node 版本不足、实际存储故障、回滚失败或未知错误仍为 BLOCKED；项目路径和生产配置保护要求不变。下文“失败保持 BLOCKED”对上述可选工具例外按 CODE_ONLY 处理。

CODE_ONLY 后用户要求恢复本地办理时，按原任务执行上述 `windows-entry`；三款收单产品仍按入口策略自动准备，本次加载内修复后重试附加 `--repair-confirmed true`，沿用本次加载的有限重试次数；仅要求只读复检时附加 `--prepare-authorized false`。其他产品继续按其自身授权策略调用。唯一 READY 才恢复快速沙箱和本地开通能力；仍为 CODE_ONLY 时继续可独立执行的开发，适用收单开通阶段交付官网指引，不反复安装。任务变化必须按新任务重新执行入口；CODE_ONLY 的本地能力事实不变，收单平台入口将其用于官网指引不代表工具恢复或本地开通获准，也不沿用旧能力事实。

## 有限环境准备

CLI 可用时复用；获得依赖准备授权后，缺失或不能运行时由官方 PowerShell 安装器处理。jq 优先复用能通过版本和实际 filter 检查的既有原生工具；缺失或不可用时安装固定 1.7.1，官方 HTTPS 资产和 SHA-256 位于 `scripts/windows/policy.json`。Node 优先复用当前可运行的 Windows x64 Node >=18.17；缺失时由根启动器的 PowerShell 引导准备官方 LTS 用户级 ZIP，SHA-256 验证后返回绝对可执行路径，本次加载首次一次、修复后最多再试一次。Git Bash 从常见目录和本机 PATH 的 Git 安装布局定位，也可由 `ALIPAY_GIT_BASH` 指定绝对路径；必须验证 Git for Windows 版本、cygpath 和 Bash 的 MINGW/MSYS 平台，不使用 System32/WSL Bash，显式指定错误时停止而不偷偷换工具。

初次缺 Git Bash、jq 或本机 CLI 无法启动且当前任务授权准备时，按 Git Bash → jq → 必要的 CLI 修复 → 完整复检执行。CLI 已可用时不重复安装。Git 优先复用已有可运行的 Git for Windows；缺失时优先调用用户级 winget，无法运行或未通过复检时使用 `scripts/windows/policy.json` 固定的 Git for Windows 官方 x64 安装包（当前 2.56.0.2）。官方包下载后先校验固定 SHA-256，再由系统 PowerShell 验证 Authenticode 有效，之后安装到 `%LOCALAPPDATA%/Programs/Git-Aipay-<version>`，并实测 git、bash、cygpath。固定包在环境目录按 SHA-256 命名缓存；下载中断保留已有字节，本次加载的有限重试中使用断点续传，服务器不支持续传时仅回退一次完整下载。取消该下载的 90 秒总时限，保留连接超时。完整缓存每次使用前仍校验 SHA-256 和 Authenticode；哈希或签名失败删除缓存，禁止执行。下载或校验失败不运行安装包。两种来源均不可用时保留实际原因：已识别的依赖准备失败返回 CODE_ONLY，三款收单在适用的产品开通阶段由平台入口交付官网指引，不要求先手工安装；仅开发任务继续可独立执行的开发。Node、实际存储故障、回滚失败及未知错误仍为 BLOCKED，按实际原因恢复，不自动转官网。用户后续要求恢复本地办理时，再提供相应恢复动作和官方安装来源。

jq 使用固定 1.7.1 官方资产和 SHA-256，已有健康版本直接复用；CLI 仍使用正式 PowerShell 安装器选择当前版本。Agent 在当前会话本次加载的上下文中记录各依赖已尝试的来源和结果。每个来源首次最多一次；网络或本地权限等失败原因恢复后，最多再试一次。Git 的 winget 失败可在同次准备中尝试官方固定包。重复触发、任务切换和同一失败命令重入不清零本次加载次数，也不循环调用安装器。新的会话重新检测实际依赖，缺失或不可用时重新准备，历史安装失败不限制本次安装。已健康的依赖直接复用，手工卸载后按实际缺失处理。复检始终只读。可选工具的网络、签名或完整性失败按[启动与分流](#启动与分流)中的 CODE_ONLY 规则分流；实际存储故障仍为 BLOCKED。不轮换未经验证的镜像、使用 WSL、提权或修改执行策略。

Windows 环境准备层不再将 Node、Git Bash、jq、CLI 和 Python 的安装次数与历史安装状态写入文件，旧 `environment.json`、`python-environment.json` 和 `node-environment.json` 不再读取或更新。环境目录用于安装包缓存和子进程临时文件。Windows 依赖安装按当前流程串行执行，不创建或检查安装文件锁；已有 `environment.lock`、`node.lock` 直接忽略，无需用户清理。多个 Agent 同时安装同一依赖仍可能发生文件替换或安装冲突。依赖可用性以本次实际探测为准。CLI 在业务任务内的刷新去重记录仍按 `run_id` 隔离，作用范围为该任务。CODE_ONLY 的官网办理无需先恢复本地工具；用户要求恢复本地办理时，按[启动与分流](#启动与分流)调用 `windows-entry`，仅只读复检时附加 `--prepare-authorized false`。以下仅适用于 BLOCKED；用户修好依赖后，用相同产品和任务的 `windows-entry --prepare-authorized false` 只读复检。已有该会话的活动业务任务时，也可执行：

```text
node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" env retry --repair-confirmed true --root-intent "<ROOT_INTENT>" --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>" --windows-route BLOCKED
```

需要再次自动安装且当前任务授权时：

```text
node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" env prepare --authorized true --repair-confirmed true --root-intent "<ROOT_INTENT>" --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>" --windows-route BLOCKED
```

如果本次加载此前只是缺少授权或没有找到安装来源，尚未实际尝试该阶段，则使用同一命令但省略 `--repair-confirmed true`，继续首次准备。安装器每次只尝试各来源一次，跨命令的有限重试由 Agent 按本次加载上下文控制。

仅退出 0、唯一 `CLI_ENV:READY` 和唯一任务匹配的 `WINDOWS_ROUTE=READY` 可恢复自动沙箱创建及本地开通能力。BLOCKED 恢复命令的其他结果保持 BLOCKED，说明具体失败原因；不重建会话、重复计数或重放业务操作。CODE_ONLY 仍禁止本地开通命令，但三款收单在单独开通或完整接入通过原开发交接条件后，可由平台入口直接交付官网指引，无需先修复本地依赖；其他产品按自身策略处理。用户明确选择站点或平台执行映射不支持时，仍可走原 LEGACY 分支。

## 路径、权限与进程

每次独立 runtime 命令首次使用 Windows 工具时完整预检。同次调用启动的 Bash、Node 和 CLI 转发子进程继承仅含执行环境信息的临时快照，核对原预检进程仍存活、Skill/Node 路径及工具文件大小与修改时间后复用，避免重复启动版本和功能探测。快照只随子进程环境传递，不写入业务状态；缺失、失效、工具变化或显式 retry 时重新完整预检。登录态、授权、业务上下文、CLI 私有目录写权限继续按原动作核验。

Skill 自有动作始终执行 `node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" ...`；不要把 Bash 脚本、环境变量赋值或 Unix 管道贴到 PowerShell。命令中的值占位符由 Agent 替换，JSON 通过宿主参数数组传递或按当前 shell 正确引用；不要把 `$RUN_ID` 等说明占位符当作已存在的 PowerShell 变量。

只转换登记的项目、配置、上传文件和脚本路径；JSON、URL、scope、公钥和业务上下文保持原样。禁用 MSYS 隐式参数转换后，适配器显式转换 `git -C` 和 native Node/jq/CLI 文件参数。快速沙箱终态的路径由 gateway 归一化为原生盘符绝对路径，脚本内部比较不变。

大 jq `--argjson` 值使用当前动作的临时文件并在调用后删除，MCC 目录使用 Node stdin，原 CLI 的 `-d/--data` 不改写；超出原生进程参数预算时明确失败，不能换未经确认的 CLI 参数。同步/异步 Shell 执行共享同一 Git Bash 适配器；适配层不额外设置整段业务 Shell、CLI 调用或依赖安装进程的总时限，执行入口显式设置的超时继续有效。短能力探测、网络连接和各下载器自身的超时分别处理，固定 Git 安装包下载使用上述缓存与续传规则。中断或超时不等于未发送或业务成功，仍按原只读核验/UNKNOWN 规则处理，不自动重放写操作。

Windows 沙箱项目配置不要求精确 NTFS ACL 白名单；项目可继承宿主或 Agent 正常工作所需的权限。环境缓存、Shell 临时目录、CLI 凭据和日志目录的 ACL 不作为入口门禁。进入登录、签约等需用 CLI 登录凭据的动作前，才验证 `~/.alipay-cli/credentials` 实际可写；失败仅阻断依赖登录凭据的动作，不阻断沙箱和项目代码开发。授权状态和公钥页状态文件只检查实际可写性与非符号链接路径，不改写继承权限；这不表示 ACL 已安全配置，密钥文件访问控制由部署环境管理。生产配置仍遵守各自脚本的保护规则。

Shell 业务子进程的临时文件放在上述环境目录的专用 tmp 中；gateway 本身不切换 TEMP/TMP。子进程原样继承显式遥测目录覆盖，未指定时沿用账号目录中的默认状态与采集偏好，不将默认状态目录转成隔离目录覆盖。业务备用状态目录独立绑定切换临时目录前的位置，避免存储故障恢复出的业务任务丢失。声明选择、会话、run、outbox 和上传状态连续。遥测文件的权限失败沿用原静默失败语义，业务计数、采集及上传逻辑不变。

完整复检取得的工具路径、版本与验证时间只保留在本次调用上下文中；子进程复用经过校验的临时执行环境快照。Git 官方安装前通过系统 `whoami.exe /groups` 的完整性 SID 判断进程是否已提升；已提升才返回 `USER_SCOPE_REQUIRED`，探测失败返回 `PERMISSION_PROBE_FAILED` 并核对系统权限探测，不能推定用户需切换账户。

402 联调仍由原生 Python 3 执行，不依赖 Git Bash。其 Node 启动器在系统临时目录下创建本次命令的独立空目录，确认实际可写后才启动 Python；仅该子进程的 TEMP/TMP/TMPDIR 与 Python `tempfile.tempdir` 指向此目录，禁止不可用时回退到其他目录。过程产物及 curl 响应文件继承用户现有目录权限；实际写入失败时不伪报 ACL 问题。子进程结束或启动异常后尽力清理本次目录，清理失败只输出内部诊断且不覆盖原始执行结果，不重放请求。父进程环境、原 Python 业务脚本、参数和退出码不变；强制终止父进程可能留下该目录，不作为恢复依据。

Windows 签约请求的 UUID 使用已有 Node 生成，仅此步骤不要求 python3/uuidgen；Unix/macOS/Linux 保留原依赖检查与生成方式。402 联调仍需 Python 3，此项依赖未被取消。

## 失败处理

所有兼容层内部 marker 只写 stderr 且以 `ALIPAY_AIPAY_INTERNAL:` 开头，不对客。`WINDOWS_ENV_RESULT` 表示环境诊断；`WINDOWS_BUSINESS_BLOCKED=ENVIRONMENT_UNAVAILABLE` 表示 gateway 在启动本次业务脚本前阻断，退出非零，本次业务 CLI 调用为零。

Integration 在上述明确的调用前阻断时停在环境恢复点，不擅自改判 LEGACY/CODE_ONLY；本例外仅处理根入口的可选工具失败。用户修复后复检 READY 才继续；沙箱脚本已经启动后，只接受原 flow 的 READY、CREATE_PENDING、VERIFY_PENDING 和精确 LOCAL_FS_RECOVERY；非零、超时、协议冲突仍停止核对，不将异常伪装成待配置、不重放原 MCP、不读取敏感配置补造成功证据。

Onboarding 的依赖安装失败停止本地依赖动作，三款收单由平台入口交付官网指引；Node、实际存储故障或未知错误等 BLOCKED 仍停在恢复点。用户要求恢复本地办理且环境 READY 后，先按原只读入口查询实际状态。授权、材料、资格和审核错误仍归原业务分支，不能统一解释为 Windows 失败。所有原有交付屏障、阻塞确认、未知写结果规则和最终收口仍有效。

## 402 的 Python 依赖

仅按量付费联调前由真实 Integration flow 登记的 `env check-python` / `env prepare-python` 准备。优先复用 `py -3`、`python`、`python3` 和常见用户/系统 Python 安装；以实际 Python 3、Windows 平台及当前脚本无 main 加载验证可用性，取得绝对解释器路径供同一启动器使用。缺失且已获依赖准备授权时只调用 winget 官方源的 `Python.Python.3.14` 用户级 x64 安装，随后重新发现并验证。winget 包的用户安装条目与官方 python.org 产物已只读核验；具体安装器按其既有行为可能更新用户 PATH，不修改系统 PATH、不主动提权。

Python 也按本次加载首次一次、失败原因恢复后最多再试一次处理，次数只记在 Agent 上下文中。安装失败不启动联调，不自动尝试其他来源；网站支付、APP 支付及单独开通不准备 Python。
