# 任务 05：改造 AI 聊天模型为多 conversation

## 任务目标

把当前单一全局 `chatHistory` 改造为多个 AI conversation。每个 conversation 有自己的消息历史，并能关联 terminal session。

## 背景业务知识

用户可能同时问多个独立问题：

- sessionA：查看磁盘。
- sessionB：查看 Java 进程。
- 回到 sessionA：继续优化磁盘命令或解释磁盘结果。

如果所有问题混在一个全局聊天里，AI 上下文会混乱。多 conversation 是后续“命令建议绑定”和“执行结果绑定”的基础。

## 前置依赖

依赖任务 04 之前的连接上下文更好，但本任务也可以独立进行。

需要知道：

- 当前 active terminal session id。
- 当前连接 profile 信息，如果已有。

## 当前项目基础

当前 AI 聊天状态主要在 `AppComponent`：

- `chatHistory: ChatHistory[]`
- `currentQuestion`
- `askAI(event)`
- `callOpenAiCompatibleApi(question, model)`
- `processNewChatEntry(entry, response)`

当前模型：

```ts
export interface ChatHistory {
  message: string;
  response: string;
  timestamp: Date;
  isCommand?: boolean;
  codeBlocks?: { code: string; language: string }[];
}
```

## 建议设计

新增模型：

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
  codeBlocks?: { code: string; language: string }[];
  isCommand?: boolean;
  referencedExecutionIds?: string[];
}
```

新增服务建议：

- `AiConversationService`

职责：

- 创建 conversation。
- 切换 active conversation。
- 添加 user / assistant message。
- 更新 message 的 codeBlocks。
- 根据 active terminal session 创建默认 conversation。

## UI 设计

AI panel 中增加轻量会话列表：

- `New Chat`
- conversation title。
- 当前 conversation 高亮。
- 可选：archive/delete。

第一期不必实现复杂树形引用，先支持切换和继续当前 conversation。

## 开发范围

本任务做：

- 新增多 conversation 数据结构。
- 将发送问题和接收回复写入当前 conversation。
- AI 调用时只使用当前 conversation 的消息。
- UI 能创建和切换 conversation。

本任务不做：

- 不实现 CommandSuggestion。
- 不绑定执行结果。
- 不做上下文预算。

## 验收标准

- 可以创建多个 AI conversation。
- 每个 conversation 独立保存消息。
- 切换 conversation 后输入问题，会追加到当前 conversation。
- AI 请求不会混入其他 conversation 的历史。

## 给任务 06 的交接

任务 06 会把 AI 回复中的命令结构化。请在完成时说明：

- `AiConversation` 和 `AiMessage` 文件路径。
- active conversation id 存在哪里。
- 添加 assistant message 的方法。
- codeBlocks 当前如何挂到 message 上。

