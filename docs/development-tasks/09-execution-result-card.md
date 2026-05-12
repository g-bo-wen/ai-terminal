# 任务 09：实现执行结果折叠卡片

## 任务目标

在 AI conversation 中展示命令执行结果卡片。卡片默认折叠，用户可以展开查看完整 rawOutput，展开区域需要限制高度并支持复制和修改。

## 背景业务知识

用户希望命令结果回到聊天窗口，但服务器输出可能很大，不能把聊天窗口撑爆。根据当前设计稿 5.4：

- 命令输出完整保存到本地 `rawOutput`。
- UI 默认折叠展示。
- 展开后展示 rawOutput。
- 展示框需要限制窗口大小，内容过多时内部滚动。
- 展示框可复制、可修改。
- 删除执行结果后，不发送给 AI。

## 前置依赖

依赖任务 08：

- `CommandExecution.rawOutput` 能被填充。
- execution 状态能从 running 变为 success / failed。
- execution 绑定在 conversation 下。

## UI 设计

每个执行结果卡片至少展示：

- command。
- status。
- exitCode。
- startedAt / finishedAt。
- 折叠时展示 outputPreview 或 rawOutput 前几行。
- 操作：`展开` / `折叠` / `删除`。

展开时：

- 使用 textarea 或可编辑区域展示 rawOutput。
- 限制最大高度，例如 240px 或 320px。
- 超出高度内部滚动。
- 用户可以复制。
- 用户可以修改文本，修改后的内容作为该 execution 后续发给 AI 的内容来源。

## 数据设计补充

如果允许修改展示内容，建议新增字段：

```ts
editableOutput?: string;
```

规则：

- 初次展开时，`editableOutput = rawOutput`。
- 用户修改后，保存到 `editableOutput`。
- 后续上下文构造优先使用 `editableOutput ?? rawOutput`。

删除行为建议：

- 如果不需要审计，可以从 conversation.executions 中移除。
- 如果希望保留审计，可以加 `deleted: true`，UI 默认不显示，且不进入上下文。

第一期可以选择简单移除，但要在交接中说明。

## 开发范围

本任务做：

- 执行结果卡片 UI。
- 折叠 / 展开。
- 展开区限制高度和滚动。
- 展开内容可复制、可修改。
- 删除执行结果。

本任务不做：

- 不实现 AI 上下文构造。
- 不实现 token 预算。
- 不做 AI 摘要。

## 验收标准

- 执行结果默认折叠。
- 展开后能看到完整输出。
- 长输出不会撑破聊天窗口。
- 展开内容可以复制和修改。
- 删除后该结果不再显示，并能被后续上下文逻辑排除。

## 给任务 10 的交接

任务 10 会实现结果是否发送给 AI 的策略。请在完成时说明：

- execution 删除是物理删除还是软删除。
- 修改后的输出保存在哪个字段。
- 卡片组件路径。
- UI 如何判断 execution 是否可进入上下文。

