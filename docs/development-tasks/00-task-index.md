# AI Terminal 第一期开发任务索引

本文档索引第一期 12 个开发任务。每个任务都有独立文件，后续可以新建一个 AI session，把“背景设计稿 + 当前任务文件 + 当前代码状态”交给 AI 进行开发。

## 总体目标

第一期目标是把当前项目从“本地 AI 命令建议终端”改造成“支持 JumpServer/SSH 连接，并能把 AI 命令建议、真实执行结果和聊天上下文串起来的排障终端”。

核心业务原则：

- SSH / JumpServer 连接配置必须第一期完成。
- AI 命令执行结果不能无脑塞进上下文。
- 命令输出要本地完整保存，聊天窗口默认折叠展示。
- 用户展开结果后可以复制、修改展示框内容。
- 用户删除执行结果后，该结果不再发送给 AI。
- 每个任务之间需要显式交接，避免后续 session 丢失上下文。

## 任务列表

1. [新建连接配置数据模型和本地存储](./01-connection-profile-model-storage.md)
2. [新建连接管理 UI 和连接显示名称调整](./02-connection-management-ui.md)
3. [实现普通 SSH Profile 点击连接](./03-ssh-profile-connect.md)
4. [实现 JumpServer Profile 自动输入目标 IP](./04-jumpserver-auto-input.md)
5. [改造 AI 聊天模型为多 conversation](./05-ai-multi-conversation.md)
6. [将 AI 命令建议结构化为 CommandSuggestion](./06-command-suggestion.md)
7. [实现命令执行和 CommandExecution 绑定](./07-command-execution-binding.md)
8. [实现 marker 识别命令结束](./08-command-marker-detection.md)
9. [实现执行结果折叠卡片](./09-execution-result-card.md)
10. [实现执行结果回填策略](./10-result-context-inclusion.md)
11. [实现上下文构造器和 token 预算](./11-context-builder-token-budget.md)
12. [真实 JumpServer 和服务器排障流程验证](./12-real-flow-verification.md)

## 推荐开发方式

每个任务建议单独开 session。新 session 的输入建议包含：

```text
1. docs/ai-terminal-secondary-development-design.md 的第 1-5 节
2. 当前任务文件
3. 上一个任务完成后的交接说明
4. 当前 git diff 或相关代码文件
```

每个任务结束时，需要在最终回复里明确：

- 修改了哪些文件。
- 新增了哪些数据结构或服务。
- 哪些行为已经可用。
- 留给下一任务的接口、约定或注意事项。
- 是否有未完成项。

