# AI Terminal 二次改造背景知识与初始设计稿

本文档记录 AI Terminal 二次改造的业务背景、核心需求、阶段任务和每个阶段的初始设计。后续可以手动修改本文档，再将“背景知识 + 某个阶段目标设计”交给 AI，用于进一步设计项目结构和实施开发。

## 1. 项目背景

AI Terminal 是一个基于 Tauri + Angular 的跨平台终端项目，当前已有能力包括：

- 使用 xterm 在桌面应用中提供本地交互式终端。
- 通过 Tauri/Rust 后端创建 PTY 会话，并把用户输入写入终端。
- 右侧提供 AI 聊天框，支持 OpenAI-compatible API 配置。
- AI 可以根据用户问题生成命令，用户可以复制、发送到终端或直接执行。

当前项目更像“带 AI 命令建议的本地终端”。二次改造目标是把它升级成适合公司内网服务器排障的 AI Terminal：

- 能管理 JumpServer / SSH 连接配置。
- 能一键通过 JumpServer 进入目标服务器。
- 能把 AI 命令建议、真实终端执行、命令输出、后续追问串成一个可控闭环。
- 能支持单问单答，也能支持带上下文的排障会话。
- 后续可以演进为带记忆、带执行力、可中断、可审查的半自动 Agent。

## 2. 业务场景

### 2.1 JumpServer 登录场景

公司开发人员不能直接连接业务服务器，只能通过 JumpServer 进入服务器。

当前人工流程：

1. 在本地终端执行 ssh 命令连接 JumpServer。
2. JumpServer 命令行展示服务器或资产列表。
3. 用户输入目标服务器 IP，例如 `192.168.23.110`。
4. JumpServer 进入目标服务器交互式 shell。

期望改造后：

1. 用户在 AI Terminal 中选择一个已保存的连接配置。
2. 工具自动打开新的 terminal session。
3. 工具自动 ssh 到 JumpServer。
4. 工具根据 JumpServer 输出提示自动输入目标服务器 IP。
5. 用户进入目标服务器后，可以正常手动操作，也可以使用 AI 辅助排障。

### 2.2 AI 辅助命令场景

当前人工流程：

1. 用户在网页 AI 聊天中输入排障问题。
2. AI 给出命令建议。
3. 用户审查命令后复制到终端执行。
4. 用户把命令输出复制回网页 AI。
5. AI 根据输出继续分析。

该流程问题：

- 命令和输出需要人工来回复制。
- AI 不知道当前终端 session 的真实状态。
- 历史命令、命令输出、上下文容易丢失。
- 多个问题混在同一个聊天里，后续追问不清晰。

期望改造后：

- AI 聊天窗口可以生成命令。
- 用户点击后命令在当前 terminal session 执行。
- 命令输出自动保存到对应 AI 会话。
- 命令输出默认折叠展示。
- AI 上下文默认只使用摘要，不无脑塞入完整输出。
- 用户可以手动把摘要、完整输出或选中片段回填到 AI 上下文。
- 用户可以引用某个 AI 会话继续追问，让 AI 在该会话上下文中优化命令或继续分析。

## 3. 核心原则

### 3.1 生产服务器安全优先

AI Terminal 面向服务器排障，默认策略必须保守。

- AI 生成的命令默认需要用户审查。
- 危险命令必须显式确认。
- 自动执行能力必须有 allowlist / blocklist。
- Agent 模式必须可暂停、可中断、可继续。
- 所有命令执行过程必须可见、可追踪、可审计。

### 3.2 SSH 配置必须进入第一期

二次改造的基础不是 AI，而是先能稳定进入目标服务器。

第一期必须支持连接配置，尤其是 JumpServer 场景。普通 SSH Profile 不足以覆盖实际需求，需要设计为 JumpServer Profile / Connection Profile。

### 3.3 AI 执行结果不能无脑塞进上下文

服务器命令输出可能很大，例如：

- `top`
- `ps -ef`
- `journalctl`
- `dmesg`
- `kubectl logs`
- 大日志文件 `cat`

如果完整输出自动进入模型上下文，会导致：

- token 快速膨胀。
- 成本增加。
- 响应变慢。
- AI 被无关噪音干扰。
- 重要信息反而被淹没。

因此第一期必须实现“结果保存、折叠展示、摘要回填、手动选择回填”的上下文策略。

### 3.4 本地保存完整事实，传给 AI 的是受控上下文

系统应区分：

- 本地完整事实：完整命令输出、原始终端 buffer、执行时间、执行状态。
- AI 输入上下文：摘要、用户选中的片段、用户明确回填的原文、最近关键观察。

完整事实用于用户查看和审计；AI 输入上下文用于模型推理，两者不能混为一谈。

## 4. 阶段规划总览

### 第一期：连接配置 + AI 会话闭环

目标：

- 支持 JumpServer / SSH 连接配置。
- 支持一键通过 JumpServer 进入目标服务器。
- 支持 AI 多会话。
- 支持命令建议、点击执行、结果绑定到对应 AI session。
- 支持命令结果折叠展示、摘要回填、手动回填。

第一期完成后，产品应从“本地 AI 命令建议终端”变成“能连接公司服务器并形成 AI 排障上下文闭环的终端”。

### 第二期：半自动排障 Agent

目标：

- 支持用户发起排障任务，例如“帮我排查 load 过高”。
- AI 生成排障计划。
- AI 在受控策略下执行只读命令。
- 每一步展示思考、命令、输出摘要、下一步建议。
- 用户可暂停、中断、修改、继续。

第二期完成后，产品应具备类似 AI 编程工具的执行循环，但执行范围和风险控制适合生产服务器。

### 第三期：记忆、模板与外部 Agent 适配

目标：

- 支持服务器画像和长期记忆。
- 支持常见排障模板。
- 支持团队级知识库。
- 预留 Hermes / OpenClaw / MCP / 其他 Agent Runtime 适配层。

第三期完成后，产品应从“单次排障工具”演进为“团队内部服务器运维排障助手”。

## 5. 第一期详细设计

### 5.1 目标 A：连接配置管理

#### 需求描述

用户可以在 UI 中维护连接配置，配置可以覆盖普通 SSH 和 JumpServer 进入目标服务器的流程。

#### 建议命名

建议使用 `Connection Profile` 作为通用名称，使用 `JumpServer Profile` 表示堡垒机场景。

#### 核心字段

```ts
interface ConnectionProfile {
  id: string;
  name: string;
  type: 'ssh' | 'jumpserver';
  jumpHost?: string;
  jumpPort?: number;
  jumpUser?: string;
  targetHost?: string;
  targetPort?: number;
  targetUser?: string;
  authMethod: 'password' | 'privateKey' | 'sshAgent' | 'manual';
  privateKeyPath?: string;
  autoInputRules: AutoInputRule[];
  tags: string[];
  description?: string;
  createdAt: string;
  updatedAt: string;
}

interface AutoInputRule {
  id: string;
  whenOutputMatches: string;
  input: string;
  appendEnter: boolean;
  enabled: boolean;
}
```

#### JumpServer 示例配置

```json
{
  "name": "生产服务器 192.168.23.110",
  "type": "jumpserver",
  "jumpHost": "jumpserver.company.com",
  "jumpUser": "developer",
  "targetHost": "192.168.23.110",
  "authMethod": "manual",
  "autoInputRules": [
    {
      "whenOutputMatches": "请选择|资产|主机|server|IP",
      "input": "192.168.23.110",
      "appendEnter": true,
      "enabled": true
    }
  ]
}
```

#### UI 设计

第一期建议新增左侧或顶部入口：

- Connections
- New Connection
- Edit Connection
- Connect
- Duplicate
- Delete

连接列表展示：

- 连接名称
- 类型：SSH / JumpServer
- 目标 IP
- 标签：prod / test / dev
- 最近连接时间

连接详情表单：

- 基本信息：名称、描述、标签。
- JumpServer 信息：地址、端口、用户。
- 目标服务器信息：目标 IP、端口、用户。
- 认证方式：手动输入、密码、私钥、ssh-agent。
- 自动输入规则：匹配输出后发送指定输入。

#### 执行流程

1. 用户点击连接配置。
2. 前端创建新的 terminal session。
3. 根据配置生成 ssh 命令。
4. 使用现有 `pty_write` 写入 ssh 命令。
5. 监听当前 PTY 输出。
6. 如果输出匹配 `AutoInputRule.whenOutputMatches`，则自动发送 `AutoInputRule.input`。
7. 进入目标服务器后，将 terminal session 标记为 connected。

#### 安全设计

- 第一期先明文长期保存密码。
- 私钥路径可以保存，但私钥内容不应复制进配置文件。
- 后续可以接入系统安全存储，例如 macOS Keychain、Windows Credential Manager、Linux Secret Service。

#### 验收标准

- 用户可以创建 JumpServer 连接配置。
- 用户点击配置后，可以自动 ssh 到 JumpServer。
- 当 JumpServer 出现资产选择提示时，可以自动输入目标 IP。
- 用户可以手动接管任何一步。
- 连接失败时能看到原始终端输出，便于排查配置问题。

### 5.2 目标 B：AI 多会话模型

#### 需求描述

当前 AI 聊天是全局线性历史，不适合多个独立问题并行排查。第一期需要支持多个 AI session。

用户场景：

1. 用户问“查看磁盘使用情况”，创建 sessionA。
2. 用户问“查看当前 Java 进程”，创建 sessionB。
3. 用户引用 sessionA 继续问“这个结果不好读，换个更适合人看的命令”。
4. 系统把问题追加到 sessionA，而不是混入 sessionB。

#### 数据结构

```ts
interface AiConversation {
  id: string;
  title: string;
  terminalSessionId: string;
  status: 'active' | 'archived';
  messages: AiMessage[];
  executions: CommandExecution[];
  createdAt: string;
  updatedAt: string;
}

interface AiMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: string;
  referencedExecutionIds?: string[];
}
```

#### UI 设计

AI 面板建议分为两层：

- 会话列表：展示多个 AI conversation。
- 会话详情：展示当前 conversation 的消息、命令建议和执行结果。

最小可行 UI：

- `New Chat`
- 当前聊天标题。
- 聊天历史列表。
- 每条历史可以 `Continue here` 或 `Reference`。

#### 上下文构造规则

调用 AI 时，不再使用全局 `chatHistory`，而是使用当前 `AiConversation`：

- 当前 conversation 的用户消息。
- 当前 conversation 的 AI 回复。
- 当前 conversation 中被标记为进入上下文的执行摘要。
- 当前 terminal session 的基础上下文，例如当前连接、目标主机。

#### 验收标准

- 用户可以创建多个 AI 会话。
- 每个 AI 会话有自己的消息历史。
- 命令执行结果能绑定到对应 AI 会话。
- 用户可以引用历史会话继续追问。

### 5.3 目标 C：命令建议与执行绑定

#### 需求描述

AI 给出命令后，用户点击执行。执行结果必须绑定到产生该命令的 AI conversation 和 command suggestion。

#### 数据结构

```ts
interface CommandSuggestion {
  id: string;
  conversationId: string;
  messageId: string;
  command: string;
  explanation?: string;
  riskLevel: 'safe' | 'review' | 'dangerous';
  createdAt: string;
}

interface CommandExecution {
  id: string;
  conversationId: string;
  suggestionId?: string;
  terminalSessionId: string;
  command: string;
  status: 'pending' | 'running' | 'success' | 'failed' | 'cancelled';
  exitCode?: number;
  rawOutput: string;
  outputPreview: string;
  outputSummary?: string;
  includedInContext: boolean;
  contextMode: 'none' | 'summary' | 'selected' | 'full';
  selectedOutput?: string;
  collapsed: boolean;
  startedAt: string;
  finishedAt?: string;
}
```

#### 执行流程

1. AI 回复中解析出命令。
2. UI 为命令生成 `CommandSuggestion`。
3. 用户点击执行。
4. 系统向当前 PTY 写入命令。
5. 系统创建 `CommandExecution`，状态为 `running`。
6. PTY 输出持续追加到 `rawOutput`。
7. 命令结束后生成 `outputPreview` 和 `outputSummary`。
8. 默认将 `contextMode` 设置为 `summary`。
9. UI 折叠展示执行结果。

#### 关键技术点

当前项目的 PTY 输出是持续流式输出。第一期需要补充“命令边界识别”能力，否则很难知道某个命令的输出何时结束。

可选方案：

- 方案 1：执行命令时追加唯一 marker。
- 方案 2：依赖 shell prompt 识别。
- 方案 3：后端提供专门的 command execution wrapper。

第一期建议使用方案 1。

示例：

```bash
df -h; printf '\n__AI_TERMINAL_COMMAND_DONE_abc123__:$?\n'
```

系统监听到 marker 后：

- 截取 marker 之前的输出作为该命令结果。
- 解析 exit code。
- 标记 execution 完成。
- 不把 marker 展示给用户。

注意：对交互式命令和全屏命令，例如 `top`，需要特殊处理。第一期可优先支持非交互式命令，并提示 AI 避免生成需要持续交互的命令，推荐 `top -b -n 1`。

#### 验收标准

- 每条 AI 命令执行后，都能在对应聊天消息下看到执行结果。
- 执行结果不会串到其他 AI 会话。
- 执行结果默认折叠。
- 可以看到命令状态：运行中、成功、失败。

### 5.4 目标 D：执行结果回填策略

#### 需求描述

命令输出可能很大，不能完整自动塞进 AI 上下文。第一期必须支持受控回填。

#### 默认策略

命令执行完成后：

1. 完整输出保存到本地 `rawOutput`, 用于列表展示。
2. UI 默认折叠展示。

#### UI 操作

每个执行结果卡片提供：

- `展开` / `折叠` / `删除`

#### 操作说明
-- UI 默认折叠, 展示 展开, 删除 卡片
1. 展开: 展示 rawOutput 的内容, 需要限制窗口大小, 增加滑动, 防止内容过多导致的窗口变动, 展示框可复制, 可修改, 此时展示 折叠, 删除 卡片
2. 折叠: 展开后, 展示框转为折叠状况
3. 删除: 执行结果删除, 不发送给 AI

#### 传给 AI 的格式

```text
Command execution context:

Command: df -h
Status: success
Output:
- /data is 92% used, size 500G, available 40G.
- / is 61% used, size 100G, available 39G.
```

#### 验收标准

- 用户可以展开查看完整输出。
- 用户可以选择摘要、完整输出或选中片段回填。
- 当前哪些执行结果进入了上下文，UI 上清晰可见。

## 6. 第二期详细设计

### 6.1 目标 A：半自动排障 Agent

#### 需求描述

用户输入一个排障目标，例如：

```text
帮我排查下这个服务器上的 load 过高的问题
```

AI 不只是给一个命令，而是进入排障循环：

1. 生成初始计划。
2. 选择下一条命令。
3. 等待用户确认或根据策略自动执行。
4. 读取执行结果摘要。
5. 形成观察。
6. 决定下一步。
7. 直到给出结论或需要用户介入。

-- AI 可以要求人工支持介入 --

#### Agent Step 数据结构

```ts
interface AgentRun {
  id: string;
  conversationId: string;
  terminalSessionId: string;
  goal: string;
  status: 'planning' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
  steps: AgentStep[];
  createdAt: string;
  updatedAt: string;
}

interface AgentStep {
  id: string;
  type: 'thought' | 'command' | 'observation' | 'decision' | 'final';
  content: string;
  executionId?: string;
  createdAt: string;
}
```

#### UI 设计

Agent 执行过程必须用 timeline 展示：

```text
1. 思考：先确认 load 类型，是 CPU、IO 还是进程阻塞。
2. 命令：uptime
3. 观察：1/5/15 分钟 load 均较高。
4. 命令：top -b -n 1
5. 观察：Java 进程 PID 1234 CPU 占用高。
6. 建议：执行 jstack 1234 查看热点线程。
```

用户操作：

- `开始`
- `暂停`
- `继续`
- `中断`
- `执行这一步`
- `跳过这一步`
- `修改命令后执行`
- `纠正 AI`

### 6.2 目标 B：命令风险控制

#### 风险等级

```ts
type CommandRiskLevel = 'safe' | 'review' | 'dangerous';
```

建议分类：

- `safe`：只读诊断命令，可在半自动模式中自动执行。
- `review`：需要用户确认，例如 `jstack`、`tcpdump`、较重的日志查询。
- `dangerous`：可能改变系统状态，默认禁止自动执行。
- 可以引入 AI 对命令进行分级, 需要设计好 AI 提示词, 对分类有详细的说明
- 如果符合了 allowlist / blocklist, 那就不需要 AI 进行命令分级

#### 验收标准

- Agent 不会默认执行危险命令。
- 每条命令执行前显示风险等级。
- 用户可以配置 allowlist / blocklist。
- 用户可以随时暂停 Agent。

## 7. 第三期详细设计

### 7.1 目标 A：服务器画像和长期记忆

#### 需求描述

系统可以为每个连接配置保存非敏感画像：

- 操作系统类型。
- Java 路径。
- 服务器已安装命令(有些特殊命令)
- 常见服务名。
- 常见日志目录。

#### 注意事项

- 不保存敏感业务数据。
- 不默认保存完整日志。
- 记忆内容需要用户可查看、可编辑、可删除。


### 7.2 目标 C：外部 Agent Runtime 适配

#### 需求描述

后续可能接入 Hermes、OpenClaw、MCP 或其他 Agent Runtime。

不建议第一期直接深度绑定某个外部 Agent。更合理的设计是抽象适配层：

```ts
interface AgentRuntimeAdapter {
  id: string;
  name: string;
  plan(input: AgentInput): Promise<AgentPlan>;
  next(input: AgentStepInput): Promise<AgentStepProposal>;
}
```

可适配对象：

- OpenAI-compatible model。
- Ollama 本地模型。
- Hermes API / CLI。
- OpenClaw API / CLI。
- MCP server。

#### 设计原则

- Terminal 执行权仍由 AI Terminal 掌握。
- 外部 Agent 只提供计划、建议和分析。
- 命令执行、安全策略、日志审计、用户确认仍在本项目内实现。

## 8. 建议优先实现顺序

第一期内部建议拆成以下开发顺序：

1. 新建连接配置数据模型和本地存储。
2. 新建连接管理 UI 和连接显示名称调整。
3. 实现普通 SSH Profile 点击连接。
4. 实现 JumpServer Profile 自动输入目标 IP。
5. 改造 AI 聊天模型为多 conversation。
6. 将 AI 命令建议结构化为 CommandSuggestion。
7. 实现命令执行和 CommandExecution 绑定。
8. 实现 marker 识别命令结束。
9. 实现执行结果折叠卡片。
10. 实现摘要 / 选中 / 完整回填策略。
11. 实现上下文构造器和 token 预算。
12. 做一轮真实 JumpServer 和服务器排障流程验证。

## 9. 后续投喂 AI 的使用方式

后续开发时，可以按如下方式把本文档拆给 AI：

```text
这是项目背景知识：
[复制第 1-4 节]

这是当前要实现的目标：
[复制某个目标，例如 5.1 连接配置管理]

请基于现有 Tauri + Angular 项目结构，设计文件结构、数据模型、服务划分、UI 组件划分，并给出分步实现计划。
```

如果让 AI 直接写代码，建议每次只给一个目标，例如：

- 只实现连接配置模型和本地存储。
- 只实现 JumpServer 自动输入规则。
- 只实现 AI 多会话数据结构。
- 只实现 CommandExecution 折叠展示。
- 只实现上下文构造器。

避免一次性让 AI 实现整个路线图。

## 10. 当前结论

本项目具备二次改造基础。当前已有 PTY、terminal tab、AI panel、OpenAI-compatible API 配置和命令执行按钮。

第一期最重要的不是引入更强的 Agent，而是先补齐两个基础能力：

1. SSH / JumpServer 连接配置。
2. AI 命令执行结果的受控回填闭环。

这两个能力完成后，AI Terminal 才能真正服务于公司内网服务器排障场景，也能为第二期半自动 Agent 打下可靠基础。
