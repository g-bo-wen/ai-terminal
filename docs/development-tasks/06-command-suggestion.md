# 任务 06：将 AI 命令建议结构化为 CommandSuggestion

## 任务目标

把 AI 回复中解析出来的命令从单纯 `codeBlocks` 升级为结构化的 `CommandSuggestion`，为后续执行绑定和风险控制打基础。

## 背景业务知识

AI 给出的命令不是普通文本，而是一个可审查、可执行、可追踪的建议。用户点击执行后，执行结果要回到产生该命令的 conversation 和 message 下。

因此需要把命令建议结构化，至少记录：

- 属于哪个 conversation。
- 属于哪条 assistant message。
- 命令内容。
- 解释。
- 风险等级。

## 前置依赖

依赖任务 05：

- 已有 `AiConversation`。
- 已有 `AiMessage`。
- AI 回复已经写入当前 conversation。
- codeBlocks 可以从回复中解析出来。

## 当前项目基础

当前命令解析逻辑在：

- `AiResponseFormatService.parseCommandFromResponse(response)`
- `AiResponseFormatService.extractCodeBlocks(text)`

当前 UI 直接基于 `entry.codeBlocks` 展示命令按钮。

## 建议设计

新增模型：

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
```

第一期风险等级可以先默认为 `review`，后续第二期再做完整风险判断。

建议把解析结果挂在 assistant message 上：

```ts
interface AiMessage {
  suggestions?: CommandSuggestion[];
}
```

或者存在 conversation 级别 map 中，但 UI 渲染时仍需要知道 suggestion 属于哪条 message。

## 开发范围

本任务做：

- 新增 `CommandSuggestion` 模型。
- AI 回复处理时生成 suggestions。
- UI 命令按钮基于 suggestion 渲染。
- 点击复制/发送到终端/执行时传 suggestion，而不是裸 command 字符串。

本任务不做：

- 不创建 `CommandExecution`。
- 不捕获命令输出。
- 不实现 marker。

## 验收标准

- AI 回复中的每条命令都有稳定 suggestion id。
- suggestion 能关联 conversationId 和 messageId。
- UI 上原有复制、发送到终端、执行按钮仍可用。
- 后续任务可以从按钮点击中拿到完整 suggestion 对象。

## 给任务 07 的交接

任务 07 会实现 CommandExecution 绑定。请在完成时说明：

- `CommandSuggestion` 类型路径。
- suggestions 存放位置。
- 执行按钮的事件参数是什么。
- 如何通过 suggestion 找到 conversation 和 message。

