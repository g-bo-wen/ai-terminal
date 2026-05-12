# 任务 12：真实 JumpServer 和服务器排障流程验证

## 任务目标

对第一期完整链路做真实或近真实验证，确保从连接配置到 AI 命令执行结果回填的核心流程可用。

## 背景业务知识

第一期不是单个功能，而是一条完整工作流：

```text
配置 JumpServer -> 一键连接 -> 自动输入目标 IP -> AI 提问 -> AI 给命令 -> 用户执行 -> 结果卡片展示 -> 用户修改/删除 -> 后续 AI 上下文正确
```

这个任务不是继续大规模开发，而是验证、修补和记录问题。

## 前置依赖

依赖任务 01-11 全部完成。

## 验证场景 A：普通 SSH

步骤：

1. 创建普通 SSH profile。
2. 点击连接。
3. 手动完成认证。
4. 确认 terminal tab 显示名称正确。
5. 在 AI 中询问 `查看当前目录`。
6. 执行 AI 给出的命令。
7. 确认 execution 卡片出现。
8. 展开、修改、删除卡片，观察上下文行为。

## 验证场景 B：JumpServer

步骤：

1. 创建 JumpServer profile。
2. 配置 jump host、jump user、target host。
3. 配置 auto input rule。
4. 点击连接。
5. 确认自动 ssh 到 JumpServer。
6. 当 JumpServer 出现提示时，确认自动输入目标 IP。
7. 如果出现 MFA 或密码，确认用户能手动接管。
8. 进入目标服务器后，确认终端可正常交互。

## 验证场景 C：AI 排障闭环

步骤：

1. 在已连接服务器的 terminal session 上创建 AI conversation。
2. 输入：`查看磁盘使用情况`。
3. AI 应给出类似 `df -h` 的命令。
4. 用户点击执行。
5. 执行结果显示为折叠卡片。
6. 展开结果，修改输出内容。
7. 继续追问：`根据刚才结果分析有没有风险`。
8. 确认 AI 能看到修改后的 execution 输出。
9. 删除 execution 后再次追问。
10. 确认 AI 不再收到该 execution 输出。

## 验证场景 D：多 conversation 隔离

步骤：

1. conversation A 问磁盘。
2. conversation B 问 Java 进程。
3. 分别执行命令。
4. 回到 conversation A 追问。
5. 确认不会混入 conversation B 的执行结果。

## 需要重点检查的问题

- JumpServer 自动输入是否重复触发。
- marker 是否污染终端输出或 rawOutput。
- 长输出是否导致聊天窗口高度异常。
- 删除 execution 后是否仍进入上下文。
- 修改后的 output 是否真的用于上下文。
- 多 conversation 是否串上下文。
- 密码是否出现在上下文或日志中。

## 交付物

本任务结束时建议新增或更新一份验证报告：

- `docs/development-tasks/phase-1-verification-report.md`

报告内容：

- 验证环境。
- 验证步骤。
- 通过项。
- 失败项。
- 需要修复的问题。
- 第二期前建议处理的技术债。

## 验收标准

- 普通 SSH 链路可用。
- JumpServer 链路可用，至少能自动输入目标 IP。
- AI 多 conversation 可用。
- AI 命令执行结果能绑定并展示。
- 删除/修改 execution 后，上下文行为正确。
- 没有发现会阻塞第一期使用的严重问题。

