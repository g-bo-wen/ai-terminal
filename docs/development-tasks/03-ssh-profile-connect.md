# 任务 03：实现普通 SSH Profile 点击连接

## 任务目标

让普通 SSH 类型的 Connection Profile 可以点击连接。点击后创建或切换到一个 terminal session，并把 ssh 命令写入当前 PTY。

## 背景业务知识

虽然公司的核心场景是 JumpServer，但普通 SSH 是连接能力的最小闭环。先打通普通 SSH，可以验证：

- 连接配置能驱动 terminal session。
- UI 的 Connect 按钮能触发真实 PTY 输入。
- 连接显示名称能落到 terminal tab。
- 后续 JumpServer 只是在普通 SSH 基础上增加自动输入规则。

## 前置依赖

依赖任务 01 和 02：

- 已有 `ConnectionProfile` 模型。
- 已有连接管理 UI。
- 点击 Connect 时能拿到 profile。

## 当前项目基础

当前创建 terminal session 的逻辑在 `AppComponent`：

- `createNewSession(name?: string, setAsActive?: boolean)`
- `switchToSession(sessionId)`
- `pty_write` Tauri command 用于向 PTY 写入内容。

现有直接执行命令方法：

- `executeCodeDirectly(code: string)`
- `sendCodeToTerminal(code: string)`

普通 SSH 可以复用 `pty_write`。

## 建议设计

新增连接启动方法，例如：

```ts
connectProfile(profile: ConnectionProfile): Promise<void>
```

普通 SSH 命令生成规则：

```text
ssh [-p port] [user@]host
```

示例：

```bash
ssh dev@192.168.23.110
ssh -p 2222 dev@192.168.23.110
```

如果 `authMethod` 是 `privateKey`：

```bash
ssh -i /path/to/key dev@192.168.23.110
```

如果是 password/manual，第一期可以让 ssh 自己在 PTY 中提示密码，由用户手动输入。

## 开发范围

本任务做：

- 实现 SSH 命令构造。
- 点击普通 SSH Profile 后创建/激活 terminal session。
- 将 ssh 命令写入 PTY 并执行。
- 更新 terminal tab 显示名称。
- 可选：记录 profile 的 `lastConnectedAt`。

本任务不做：

- 不自动输入密码。
- 不实现 JumpServer 自动输入目标 IP。
- 不判断连接是否成功。
- 不做 AI 上下文关联。

## 安全注意

不要在日志中打印密码。即使第一期允许保存密码，也不要把密码拼入调试输出。

## 验收标准

- 创建普通 SSH profile 后，点击 Connect 能打开/切换 terminal session。
- 终端中能看到 ssh 命令被执行。
- 连接 tab 名称能体现 profile 名称或目标 host。
- 用户可以在 PTY 中继续手动输入密码或 MFA。

## 给任务 04 的交接

任务 04 会基于本任务增加 JumpServer 自动输入。请在完成时说明：

- 连接启动方法路径和名称。
- SSH 命令构造方法路径和名称。
- terminal session 如何关联 profile。
- PTY 输出监听目前在哪里处理。
- 是否已有 active connection 状态字段。

