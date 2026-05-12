# 任务 08：实现 marker 识别命令结束

## 任务目标

为通过 AI 执行的命令追加唯一 marker，通过监听 PTY 输出识别命令何时结束，并把输出写入对应 `CommandExecution.rawOutput`。

## 背景业务知识

服务器命令输出是流式的。如果不知道命令边界，就无法把输出准确绑定到某次 AI 命令执行。marker 是第一期最简单可靠的命令边界方案。

## 前置依赖

依赖任务 07：

- 已有 `CommandExecution`。
- 点击执行会创建 running execution。
- 可以根据 terminalSessionId 找到 running execution。

## 当前项目基础

PTY 输出在 `registerPtyListeners()` 中监听：

- payload 包含 `sessionId` 和 `data`。
- 当前逻辑会把数据追加到 `ptyBufferBySession`。
- active session 输出写入 xterm。

## 建议设计

执行 AI 命令时，不直接写：

```bash
df -h
```

而是写：

```bash
df -h; printf '\n__AI_TERMINAL_COMMAND_DONE_abc123__:%s\n' "$?"
```

PowerShell 后续可单独适配。第一期重点是服务器 Linux shell 场景。

marker 数据结构：

```ts
interface RunningExecutionState {
  executionId: string;
  terminalSessionId: string;
  marker: string;
  outputBuffer: string;
}
```

监听输出时：

1. 如果 session 有 running execution，则把输出追加到 buffer。
2. 检查 buffer 是否包含 marker。
3. 找到 marker 后，marker 之前作为 rawOutput。
4. 解析 exit code。
5. 更新 execution status、exitCode、finishedAt、rawOutput。
6. marker 本身不进入 execution rawOutput。

## 重要注意

终端中仍应展示用户命令输出，但 marker 最好不要展示给用户。如果短期内过滤 marker 较复杂，至少不要把 marker 存入 execution rawOutput。

对交互式命令要保守：

- `top` 应建议使用 `top -b -n 1`。
- 不要自动包装持续运行的命令。
- 后续可增加超时和取消。

## 开发范围

本任务做：

- 执行 AI 命令时追加唯一 marker。
- 监听 PTY 输出并捕获 execution rawOutput。
- 识别 exit code。
- 更新 execution 状态为 success / failed。

本任务不做：

- 不做折叠卡片 UI。
- 不做复杂命令风险识别。
- 不做交互式命令完整支持。

## 验收标准

- 执行 `df -h` 后，execution 能保存输出。
- marker 不进入 execution 的 rawOutput。
- 命令成功时 status 为 success。
- 命令失败时 status 为 failed，并记录 exitCode。
- 输出不会绑定到错误的 conversation。

## 给任务 09 的交接

任务 09 会展示执行结果卡片。请在完成时说明：

- execution 完成后字段如何更新。
- rawOutput 是否包含命令 echo。
- outputPreview 是否已经生成，没有的话由任务 09 生成。
- marker 是否还会显示在终端界面。

