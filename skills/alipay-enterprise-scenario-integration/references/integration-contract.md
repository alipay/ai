# 项目判断与已有项目衔接契约

代码生成前先检查目标目录和用户上下文，自动判断是新工程还是已有项目增量接入。不要把“新项目还是已有项目”作为默认必问题。

按已有项目处理：

- 用户明确说“已有项目”“现有工程”“增量接入”“改造”“补齐”或“在当前项目里接入”。
- 目标目录存在构建或依赖文件，例如 `pom.xml`、`build.gradle`、`package.json`、`go.mod`、`pyproject.toml`、`requirements.txt`、`.csproj`。
- 目标目录存在 `src/`、`app/`、启动入口、配置文件、Controller、Service、Repository、Entity、业务包或能反映项目用途的 README。

按新工程处理：

- 用户明确说“新建工程”“从零生成”“生成一个项目”。
- 目标目录不存在，且用户要求生成新工程。
- 目标目录为空，或只包含 `.DS_Store`、空 README、临时文件、空目录等弱信号。

只有以下情况才暂停确认：

- 目标目录无法访问或权限不足。
- 用户描述和目录证据明显冲突。
- 目录既有强已有项目信号又有强新工程信号，且上下文无法判断用户意图。

确认问题只问项目类型，不混入费控模式、因公优先、模块范围等其它决策。

已有项目增量接入时，主 Agent 第一轮只输出盘点和拟定契约，不修改代码。用户确认后，在生成目录写入 `.alipay-skill/integration-contract.json`，再启动分域代码修改。

契约用于把员企、费控、账单三个本域衔接点汇总到一个文件。子 Skill 单独接入已有项目时也使用同一文件结构，但只填写自己的 domain。

最小结构：

```json
{
  "schemaVersion": 1,
  "projectMode": "existing",
  "baseline": {
    "sdkVersion": "当前项目版本",
    "targetSdkVersion": "Central Portal 当前版本",
    "buildStatus": "passed | failed | not-run"
  },
  "conventions": {
    "basePackage": "com.example",
    "notifyEntry": "src/main/.../AlipayNotifyController.java"
  },
  "domains": {
    "ec": {
      "status": "CONFIRMED",
      "joinPoints": [],
      "changes": [{ "path": "src/main/.../EcEmployeeService.java", "action": "add" }]
    },
    "expense-control": {
      "status": "CONFIRMED",
      "joinPoints": [],
      "changes": [{ "path": "src/main/.../ExpenseControlService.java", "action": "add" }]
    },
    "bill": {
      "status": "CONFIRMED",
      "joinPoints": [],
      "changes": [{ "path": "src/main/.../BillNotifyHandler.java", "action": "add" }]
    }
  },
  "gaps": []
}
```

规则：

1. `gaps` 中不得保留 `NEEDS_USER_CONFIRM`。
2. 单场景主方案已有项目必须包含 `ec`、`expense-control`、`bill` 三个 domain，除非用户明确裁剪模块并写为 `NOT_APPLICABLE`。
3. 每个 domain 的 `status` 必须是 `CONFIRMED` 或 `NOT_APPLICABLE`。
4. `joinPoints` 支持 service、repository、controller、event、gateway、spi、other 等策略，不要求 handler 直接引用某个类型。
5. `evidenceFiles` 和 `changes.path` 必须指向项目内真实文件，不得逃出项目目录。
6. 无法推断衔接点时必须暂停确认；用户明确接受旁路验证前，不得生成仅日志、仅幂等记录或固定成功的默认路径。

校验已有项目时使用：

```bash
ALIPAY_PROJECT_MODE=existing node alipay-enterprise-scenario-integration/scripts/validate_codegen.js <项目目录>
```
