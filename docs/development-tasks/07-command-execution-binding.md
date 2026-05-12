# 任务 07：实现命令执行和 CommandExecution 绑定

## 任务目标

用户点击某条 `CommandSuggestion` 执行时，创建 `CommandExecution`，并将其绑定到对应 conversation、suggestion 和 terminal session。

## 背景业务知识

AI Terminal 的核心闭环是：

```text
用户问题 -> AI 命令建议 -> 用户点击执行 -> 服务器真实输出 -> 回到同一个 AI 会话
```

如果没有 `CommandExecution`，后续就无法知道某段输出属于哪条命令，也无法控制它是否进入 AI 上下文。

## 前置依赖

依赖任务 06：

- 已有 `CommandSuggestion`。
- 执行按钮能拿到 suggestion。
- 当前 active conversation 和 terminal session 可用。

## 当前项目基础

当前执行命令方法：

- `executeCodeDirectly(code: string)`

它现在只是把命令加上 `\n` 写入 PTY，并向 `commandHistory` 添加一条记录。

本任务需要新增执行记录，但暂时可以不准确判断命令结束。命令结束识别在任务 08。

## 建议设计

新增模型：

```ts
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

根据用户修改后的 5.4，第一期实现时可以先这样理解：

- `rawOutput` 是完整输出。
- `collapsed` 控制 UI 折叠。
- `includedInContext` 表示是否会发送给 AI。
- 删除执行结果后，等价于从 conversation 中移除该 execution，或标记为不进入上下文。

## 开发范围

本任务做：

- 新增 `CommandExecution` 模型。
- 点击执行 suggestion 时创建 execution。
- execution 状态从 `pending` 变为 `running`。
- 将 execution 挂到当前 conversation。
- 记录 command、conversationId、suggestionId、terminalSessionId。

本任务不做：

- 不精确截取输出。
- 不识别命令结束 marker。
- 不实现执行结果卡片 UI。
- 不实现上下文构造。

## 验收标准

- 点击 AI 命令执行后，会生成一条 execution。
- execution 关联正确的 conversation 和 suggestion。
- execution 关联当前 terminal session。
- 命令仍能写入 PTY 执行。

## 给任务 08 的交接

任务 08 会实现 marker 识别命令结束。请在完成时说明：

- running execution 存在哪里。
- 如何根据 terminalSessionId 找到当前 running execution。
- 执行命令的统一入口方法。
- 是否允许同一个 terminal session 同时有多个 running execution。

