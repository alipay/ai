# 支付宝企业码场景接入标准方案 Skill

本 Skill 用于企业码单场景接入。它负责识别或确认一个费用场景，并编排员企、费控、账单三个领域 Skill，输出接入方案或生成接入代码。

## 适用场景

适合以下任务：

- 设计企业码餐饮、地铁、公交、用车、酒店、商城、生活服务、票务、加油、医疗等单一费用场景接入方案；
- 在新工程中生成企业码标准场景接入代码；
- 在已有工程上增量接入企业码能力；
- 需要统一处理员企、费控、账单三域组合的接入任务。

每次只处理一个业务场景。用户一次提出多个场景时，应先确认本次接入哪一个。

## 能力边界

本 Skill 负责：

- 场景决策：费用类型、费用子类、因公场景、必用规则因子、因公优先状态；
- 方案编排：默认三域基础模块、已有项目衔接、多 Agent 分域生成；
- 质量门禁：SDK 或 HTTP(S) 预检、接口证据表、主子 validator 聚合校验；
- 生成约束：字段、枚举、SDK 类和接口参数必须来自引用文档，不得猜测。

本 Skill 不负责替接入方完成真实生产配置和业务实现，例如支付宝应用密钥、生产幂等存储、业务落库、上线灰度和真实联调验收。

## 子 Skill 安装

本方案内置三个领域 Skill 的 ZIP 包，使用时由安装脚本自动解压到当前 Skills 根目录，并与本方案 Skill 平级：

- `alipay-enterprise-ec`
- `alipay-enterprise-expense-control`
- `alipay-enterprise-bill`

安装或使用前，先执行：

```bash
node alipay-enterprise-scenario-integration/tools/install_subskills.js
```

脚本会检查平级目录中是否已存在完整领域 Skill；缺失时从 `subskills/*.zip` 事务式解压并校验。失败时应停止处理，不要让模型在子 Skill 不完整时继续猜测，也不要把手工解压作为接入方步骤。

## 版本检查

本 Skill 在 GitHub 版本中包含 `skill.json` 和 `CHANGELOG.md`。如需检查本地版本是否落后，可执行：

```bash
node alipay-enterprise-scenario-integration/tools/check_version.js
```

该脚本只提示版本状态，不会自动下载、更新或覆盖本地文件。发现新版本时，由用户决定是否更新本地 Skill。

## 典型流程

1. 安装并验证三个子 Skill。
2. 识别或确认单一业务场景。
3. 写入 `<项目>/.alipay-skill/scenario.json`。
4. 判断新工程或已有工程增量接入。
5. 代码生成前完成 SDK 或 HTTP(S) 预检。
6. 按员企、费控、账单分域读取文档、生成代码并完成本域自检。
7. 聚合公共配置、消息入口和跨域逻辑。
8. 执行主聚合校验。

代码生成完成后必须执行主聚合校验。主校验会调用三个子域 validator，并检查场景决策、分域代码和跨域聚合是否一致。具体命令和退出码以 `SKILL.md` 与 `references/quality-gates/aggregate.md` 为准。

## 目录说明

```text
alipay-enterprise-scenario-integration/
  SKILL.md                         # Agent 读取的主入口
  references/                      # 场景决策、编排、衔接契约和聚合质量门禁
  scripts/                         # 主聚合 validator 和共享校验库
  subskills/                       # 三个领域 Skill 的 ZIP 包
  tests/                           # validator 回归测试
  tools/                           # 子 Skill 安装与维护工具
```

## 维护提示

- 更新任一领域 Skill 后，需要重新打包对应 `subskills/*.zip`。
- 修改 validator 后，需要运行本 Skill 的 `tests/run.js`。
- 本 Skill 的 `README.md` 面向人读；真正约束 Agent 行为的入口仍是 `SKILL.md`。
