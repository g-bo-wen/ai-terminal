# 任务 11：实现上下文构造器和 token 预算

## 任务目标

实现统一的 AI 上下文构造器，把当前 conversation、连接信息、terminal session 信息和允许进入上下文的 command execution 组合成模型请求消息，同时限制上下文长度，避免 token 爆掉。

## 背景业务知识

AI 需要知道：

- 用户当前在排查什么。
- 当前连接的是哪台服务器。
- AI 之前建议过什么命令。
- 用户执行了哪些命令。
- 哪些执行结果被用户保留下来并允许发送给 AI。

但 AI 不应该收到：

- 所有终端历史。
- 所有原始长输出。
- 用户已删除的执行结果。
- 无关 conversation 的内容。

## 前置依赖

依赖任务 10：

- execution 是否进入上下文已有统一判断。
- execution 可以生成 context text。
- 删除和修改输出行为已明确。

## 当前项目基础

当前 AI 调用在 `callOpenAiCompatibleApi(question, model)` 中直接拼 messages。

它现在会加入：

- system prompt。
- 旧 chatHistory。
- 当前目录。
- 最近命令。
- 当前问题。

本任务应把上下文构造抽成服务，避免 `AppComponent` 越来越大。

## 建议设计

新增服务：

- `AiContextBuilderService`

输入：

```ts
interface BuildAiContextInput {
  conversation: AiConversation;
  currentQuestion: string;
  terminalSession?: TerminalSession;
  connectionProfile?: ConnectionProfile;
  os: string;
}
```

输出：

```ts
interface BuiltAiContext {
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[];
  omittedContextNotice?: string;
}
```

## token / 长度预算

第一期可以不用精确 tokenizer，先用字符预算：

- conversation messages 上限：例如 12000 字符。
- executions 上限：例如 8000 字符。
- 单条 execution 上限：例如 3000 字符。
- 总上下文上限：例如 20000 字符。

裁剪优先级：

1. system prompt 保留。
2. 当前用户问题保留。
3. 最近几轮对话优先。
4. 用户未删除且 includedInContext 的 executions 保留。
5. 超长 execution 截断，并标注已截断。
6. 老旧对话可裁剪。

## 连接上下文

如果任务 04 已提供连接信息，应加入：

```text
Current connection:
- Profile name: ...
- Type: jumpserver
- Jump host: ...
- Target host: ...
```

不要加入密码。

## 开发范围

本任务做：

- 抽出上下文构造服务。
- 当前 AI 调用改用该服务。
- 只使用当前 conversation。
- 加入允许进入上下文的 executions。
- 排除删除或 includedInContext=false 的 executions。
- 实现字符预算和截断说明。

本任务不做：

- 不做真实 tokenizer。
- 不做 AI 摘要。
- 不做 Agent。

## 验收标准

- AI 请求只包含当前 conversation。
- 删除的执行结果不会被发送。
- 修改后的 execution 输出会进入上下文。
- 超长输出会被截断，不会无限塞入请求。
- 上下文中不包含密码。

## 给任务 12 的交接

任务 12 会做真实流程验证。请在完成时说明：

- 上下文构造服务路径。
- 字符预算配置在哪里。
- 如何查看最终发送给 AI 的上下文。
- 哪些内容会被排除。

