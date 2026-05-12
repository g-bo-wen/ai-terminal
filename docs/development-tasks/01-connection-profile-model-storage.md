# 任务 01：新建连接配置数据模型和本地存储

## 任务目标

为 SSH / JumpServer 连接配置建立前端数据模型和本地存储能力。此任务不要求实现连接 UI，也不要求真的发起 SSH，只需要让项目具备保存、读取、更新、删除连接配置的基础能力。

## 背景业务知识

公司开发人员不能直接连接服务器，只能通过 JumpServer 进入目标服务器。用户希望在 AI Terminal 中保存连接配置，然后一键进入服务器。

连接配置必须覆盖两类场景：

- 普通 SSH：直接连接某台服务器。
- JumpServer：先 ssh 到堡垒机，再根据命令行提示输入目标服务器 IP。

第一期可以先使用本地存储。根据当前设计稿，密码第一期允许明文长期保存，但实现时应把密码字段集中在模型里，方便后续替换成系统安全存储。

## 当前项目基础

当前 Angular 代码在 `ai-terminal/src/app` 下。已有模型目录：

- `models/terminal-session.model.ts`
- `models/command-history.model.ts`
- `models/chat-history.model.ts`

已有服务目录：

- `services/terminal-session.service.ts`
- `services/ai-command.service.ts`
- `services/open-ai-compatible-connection.service.ts`

AI 设置当前使用 `localStorage` 保存，因此连接配置第一期也可以先用 `localStorage`。

## 建议设计

新增模型：

```ts
export interface ConnectionProfile {
  id: string;
  name: string;
  type: 'ssh' | 'jumpserver';
  jumpHost?: string;
  jumpPort?: number;
  jumpUser?: string;
  jumpPassword?: string;
  targetHost?: string;
  targetPort?: number;
  targetUser?: string;
  targetPassword?: string;
  authMethod: 'password' | 'privateKey' | 'sshAgent' | 'manual';
  privateKeyPath?: string;
  autoInputRules: AutoInputRule[];
  tags: string[];
  description?: string;
  lastConnectedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AutoInputRule {
  id: string;
  whenOutputMatches: string;
  input: string;
  appendEnter: boolean;
  enabled: boolean;
}
```

新增服务建议命名：

- `ConnectionProfileService`

服务职责：

- `listProfiles()`
- `getProfile(id)`
- `createProfile(input)`
- `updateProfile(id, patch)`
- `deleteProfile(id)`
- `duplicateProfile(id)`
- `markConnected(id)`
- `createDefaultProfile()`

## 开发范围

本任务只做：

- 新增连接配置模型。
- 新增本地存储服务。
- 提供基本 CRUD 方法。
- 给服务写基础单元测试或至少保证 TypeScript 编译通过。

本任务不做：

- 不做 UI。
- 不调用 `pty_write`。
- 不处理自动输入规则匹配。
- 不实现密码安全存储。

## 交付物

- 新增 `ConnectionProfile` / `AutoInputRule` 模型。
- 新增连接配置存储服务。
- 本地存储 key 命名清晰，例如 `ai-terminal.connection-profiles`。
- 服务方法能处理空数据、坏 JSON、缺失字段等情况。

## 验收标准

- 项目能编译。
- 可以通过服务创建、读取、修改、删除连接配置。
- 新建配置有稳定 `id`、`createdAt`、`updatedAt`。
- JumpServer 配置可以保存 `jumpHost`、`jumpUser`、`targetHost` 和 `autoInputRules`。

## 给任务 02 的交接

任务 02 会基于本任务的模型和服务构建 UI。请在完成时说明：

- 模型文件路径。
- 服务文件路径。
- localStorage key。
- 创建默认 profile 的方法名。
- 是否已经有示例数据或 mock 数据。

