# 任务 04：实现 JumpServer Profile 自动输入目标 IP

## 任务目标

让 JumpServer 类型的 Connection Profile 可以点击连接，并在 JumpServer 输出匹配规则时自动输入目标服务器 IP 或配置中的指定内容。

## 背景业务知识

公司的真实登录流程是：

1. ssh 到 JumpServer。
2. JumpServer 展示资产列表或选择提示。
3. 用户输入目标服务器 IP。
4. 进入目标服务器。

本任务要替代第 3 步，减少重复人工操作。但用户必须可以随时手动接管，因为 JumpServer 可能出现密码、MFA、提示文案变化等情况。

## 前置依赖

依赖任务 03：

- 普通 SSH Profile 已能点击连接。
- `connectProfile(profile)` 或类似方法已存在。
- PTY 输出可以在前端监听。
- terminal session 可以关联当前 profile。

## 当前项目基础

当前 PTY 输出监听在 `AppComponent.registerPtyListeners()`：

- 监听 `pty_output`。
- 把输出追加到 `ptyBufferBySession`。
- 如果是 active session，则写入 xterm。

JumpServer 自动输入可以在这里或独立服务中处理。

## 建议设计

新增运行态结构：

```ts
interface ActiveConnectionRuntime {
  terminalSessionId: string;
  profileId: string;
  profileType: 'ssh' | 'jumpserver';
  pendingAutoInputRuleIds: string[];
  firedAutoInputRuleIds: string[];
  createdAt: string;
}
```

执行流程：

1. 用户点击 JumpServer profile。
2. 创建/激活 terminal session。
3. 执行 `ssh jumpUser@jumpHost`。
4. 将该 terminal session 标记为 active JumpServer connection。
5. 每次收到 PTY 输出时，拿输出片段匹配 enabled auto input rules。
6. 匹配成功后发送规则 input。
7. 如果 `appendEnter` 为 true，则追加 `\n`。
8. 记录该规则已触发，避免重复输入。

## 自动输入规则

规则字段：

- `whenOutputMatches`：正则字符串或普通字符串。
- `input`：要输入的内容，通常是目标 IP。
- `appendEnter`：是否自动回车。
- `enabled`：是否启用。

第一期建议按正则处理，但需要 try/catch。如果正则非法，可以降级为 includes 或在 UI 显示错误。

## 开发范围

本任务做：

- JumpServer profile 点击连接。
- 自动输入规则匹配。
- 自动发送目标 IP。
- 防止同一规则重复触发。
- 用户可以手动接管。

本任务不做：

- 不保证识别“已进入目标服务器”的最终状态。
- 不自动处理 MFA。
- 不做复杂 expect 脚本语言。
- 不做 AI 相关功能。

## 验收标准

- JumpServer profile 可以执行 ssh 到 jump host。
- 当 PTY 输出出现配置的匹配文本时，可以自动输入目标 IP。
- 自动输入只触发一次或按规则控制，不会无限重复。
- 用户仍可在终端中手动输入。
- 连接失败时原始终端输出仍完整可见。

## 给任务 05 的交接

任务 05 会改造 AI 多 conversation。请在完成时说明：

- terminal session 如何知道当前连接 profile。
- 是否能拿到当前连接显示名称、targetHost、jumpHost。
- 当前连接上下文是否有统一 getter。
- PTY 输出监听是否被拆到服务中。

