# 任务 10：实现执行结果回填策略

## 任务目标

实现执行结果进入 AI 上下文的控制策略。根据当前设计稿修改后的 5.4，第一期重点不是复杂摘要系统，而是确保执行结果本地保存、默认折叠、可编辑、可删除，并且只有未删除且被允许的内容才发送给 AI。

## 背景业务知识

命令输出可能很大，不能无脑塞进 AI 上下文。用户希望：

- 结果先作为折叠卡片显示在聊天窗口。
- 展开后可以复制、修改。
- 删除后不发送给 AI。
- 后续 AI 使用的内容应该是用户保留下来的执行结果内容，而不是所有终端输出。

文档第 8 节仍写着“摘要 / 选中 / 完整回填策略”，但第 5.4 已被简化。实现时应按 5.4 的最新业务口径做第一版，同时保留字段扩展能力。

## 前置依赖

依赖任务 09：

- 执行结果卡片已存在。
- rawOutput 可展示。
- 用户可修改展开内容。
- 用户可删除 execution。

## 建议策略

第一期推荐实现最小策略：

```ts
interface CommandExecution {
  includedInContext: boolean;
  contextMode: 'none' | 'full';
  rawOutput: string;
  editableOutput?: string;
  deleted?: boolean;
}
```

默认值建议：

- 执行成功后 `includedInContext = true`。
- `contextMode = 'full'`，但上下文构造器后续会做 token 裁剪。
- 用户删除后 `includedInContext = false` 或 `deleted = true`。
- 如果用户修改了展开内容，AI 使用 `editableOutput`。

如果担心默认 full 太大，也可以默认：

- `includedInContext = false`

然后在卡片上提供 `发送给 AI` / `不发送给 AI` 开关。但这会比文档 5.4 多一个交互。若实现该开关，需要保持 UI 清晰。

## UI 建议

卡片操作可以从 5.4 的三个按钮扩展为：

- `展开` / `折叠`
- `删除`
- 可选：`发送给 AI` 开关

如果实现开关，UI 必须清楚显示当前状态：

- `将发送给 AI`
- `不会发送给 AI`

## 传给 AI 的格式

后续上下文构造时应使用类似格式：

```text
Command execution context:

Command: df -h
Status: success
Output:
[editableOutput or rawOutput]
```

本任务可以先实现生成单个 execution context 字符串的方法，供任务 11 使用。

## 开发范围

本任务做：

- 明确 execution 是否进入 AI 上下文的字段和行为。
- 删除后确保不会进入 AI 上下文。
- 修改后的输出优先作为 AI 上下文来源。
- 可选实现“发送给 AI”开关。
- 提供 execution -> context text 的基础方法。

本任务不做：

- 不实现完整 token 预算。
- 不实现复杂摘要。
- 不实现选中片段。

## 验收标准

- 删除的执行结果不会进入 AI 上下文。
- 用户修改过的输出会覆盖 rawOutput 进入后续上下文。
- UI 能清楚看出某个 execution 是否会发送给 AI。
- 有统一方法把 execution 转成 AI context 文本。

## 给任务 11 的交接

任务 11 会实现上下文构造器和 token 预算。请在完成时说明：

- execution 是否进入上下文的判断方法。
- 使用 rawOutput 还是 editableOutput 的规则。
- 单条 execution context 文本生成方法路径。
- 是否已有上下文开关 UI。

