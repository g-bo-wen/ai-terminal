# 任务 02：新建连接管理 UI 和连接显示名称调整

## 任务目标

基于任务 01 的连接配置模型和存储服务，实现连接管理 UI。用户可以创建、编辑、删除、复制连接配置，并能在 UI 中看到连接显示名称。

## 背景业务知识

用户需要把常用 JumpServer / 目标服务器配置保存下来，避免每次手动输入多条命令。连接管理 UI 是后续“一键连接”和“AI 知道当前服务器上下文”的入口。

连接显示名称很重要。用户进入多个服务器时，terminal tab 不能只显示 `Terminal 1`，需要能看出连接目标，例如：

- `prod-order 192.168.23.110`
- `jump -> 192.168.23.110`
- `dev-java-01`

## 前置依赖

依赖任务 01：

- `ConnectionProfile` 模型已存在。
- `ConnectionProfileService` 已提供 CRUD。

## 当前项目基础

主界面在：

- `ai-terminal/src/app/app.component.ts`
- `ai-terminal/src/app/app.component.html`
- `ai-terminal/src/app/app.component.css`

终端 tab 组件在：

- `ai-terminal/src/app/components/terminal-tab/`

当前 AI 面板已有 `Chat` / `Settings` 两个 tab。连接管理可以先用简单入口实现，不必一次性做复杂布局。

## 建议设计

新增连接管理区域，最小可行方案：

- 在顶部或左侧增加 `Connections` 入口。
- 展示连接配置列表。
- 提供 `New`、`Edit`、`Duplicate`、`Delete`、`Connect` 按钮。
- 表单支持普通 SSH 和 JumpServer 两种类型。
- 表单支持自动输入规则列表。

连接列表建议展示：

- 名称。
- 类型：SSH / JumpServer。
- JumpServer 地址。
- 目标服务器 IP。
- 标签。
- 最近连接时间。

## 开发范围

本任务只做 UI 管理和显示名称能力：

- 连接配置列表。
- 新建/编辑表单。
- 删除/复制。
- 连接显示名称生成函数。
- 可以把 `Connect` 按钮先留为 disabled 或调用空方法。

本任务不做：

- 不真正发起 SSH。
- 不监听 PTY 输出。
- 不做自动输入规则执行。

## 设计注意事项

UI 不要做成营销页，要像工具界面：

- 信息密度适中。
- 表单清晰。
- 按钮明确。
- 避免卡片套卡片。

认证方式第一期可简单处理：

- `manual`
- `password`
- `privateKey`
- `sshAgent`

密码字段可以出现，但要让后续任务知道当前是明文本地保存。

## 验收标准

- 用户可以在 UI 中创建 SSH 配置。
- 用户可以在 UI 中创建 JumpServer 配置。
- 用户可以添加至少一条自动输入规则。
- 用户可以编辑、复制、删除配置。
- 连接列表能显示目标服务器和 JumpServer 信息。
- 终端显示名称生成逻辑可被任务 03 使用。

## 给任务 03 的交接

任务 03 会实现普通 SSH Profile 点击连接。请在完成时说明：

- `Connect` 按钮或事件所在组件。
- 点击连接时能拿到的 `ConnectionProfile` 对象。
- 显示名称生成函数在哪里。
- 是否已经给 terminal session 预留 connection profile id 字段。

