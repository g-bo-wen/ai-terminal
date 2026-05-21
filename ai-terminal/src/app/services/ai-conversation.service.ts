import { Injectable } from '@angular/core';
import { invoke } from '@tauri-apps/api/core';
import { AiCodeBlock, AiConversation, AiMessage } from '../models/ai-conversation.model';
import { CommandExecution, CommandExecutionStatus } from '../models/command-execution.model';
import { CommandSuggestion } from '../models/command-suggestion.model';

export interface CreateAiMessageInput {
  role: AiMessage['role'];
  content: string;
  rawContent?: string;
  codeBlocks?: AiCodeBlock[];
  suggestions?: CommandSuggestion[];
  isCommand?: boolean;
  referencedExecutionIds?: string[];
}

export interface UpdateAiMessagePatch {
  content?: string;
  rawContent?: string;
  codeBlocks?: AiCodeBlock[];
  suggestions?: CommandSuggestion[];
  isCommand?: boolean;
  referencedExecutionIds?: string[];
}

export interface CreateCommandExecutionInput {
  conversationId: string;
  suggestionId?: string;
  terminalSessionId: string;
  command: string;
}

@Injectable({
  providedIn: 'root'
})
export class AiConversationService {
  private readonly recentConversationLimit = 10;
  private readonly executionContextMaxChars = 8000;
  private readonly executionContextSingleOutputMaxChars = 3000;
  private conversations: AiConversation[] = [];
  private activeConversationId = '';
  private runningExecutionIdsByTerminalSession = new Map<string, string>();
  private persistQueuesByConversationId = new Map<string, Promise<void>>();
  private deletedConversationIds = new Set<string>();

  async loadRecentConversations(limit: number = this.recentConversationLimit): Promise<void> {
    try {
      const conversations = await invoke<unknown[]>('list_ai_conversations', { limit });
      this.conversations = conversations
        .map((conversation) => this.normalizeConversation(conversation))
        .filter((conversation): conversation is AiConversation => Boolean(conversation))
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .slice(0, limit);
      this.activeConversationId = '';
      this.runningExecutionIdsByTerminalSession.clear();
    } catch (error) {
      console.error('Failed to load AI conversations:', error);
    }
  }

  listConversations(): AiConversation[] {
    return this.conversations
      .filter((conversation) => conversation.status === 'active')
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, this.recentConversationLimit);
  }

  getActiveConversationId(): string {
    return this.activeConversationId;
  }

  getActiveConversation(): AiConversation | undefined {
    return this.getConversation(this.activeConversationId);
  }

  getConversation(conversationId: string): AiConversation | undefined {
    return this.conversations.find((conversation) => conversation.id === conversationId);
  }

  createConversation(terminalSessionId: string, title?: string): AiConversation {
    const now = new Date().toISOString();
    const conversation: AiConversation = {
      id: this.createClientId('conversation'),
      title: title?.trim() || `Chat ${this.conversations.length + 1}`,
      terminalSessionId,
      status: 'active',
      messages: [],
      executions: [],
      createdAt: now,
      updatedAt: now
    };

    this.conversations = [...this.conversations, conversation];
    this.activeConversationId = conversation.id;
    this.schedulePersistConversation(conversation.id);
    return conversation;
  }

  ensureConversationForTerminalSession(terminalSessionId: string): AiConversation {
    const activeConversation = this.getActiveConversation();
    if (activeConversation?.terminalSessionId === terminalSessionId) {
      return activeConversation;
    }

    const existingConversation = this.listConversations()
      .filter((conversation) => conversation.terminalSessionId === terminalSessionId)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];

    if (existingConversation) {
      this.activeConversationId = existingConversation.id;
      return existingConversation;
    }

    return this.createConversation(terminalSessionId);
  }

  setActiveConversation(conversationId: string): AiConversation | undefined {
    const conversation = this.getConversation(conversationId);
    if (!conversation || conversation.status !== 'active') {
      return undefined;
    }

    this.activeConversationId = conversation.id;
    return conversation;
  }

  clearActiveConversation(): void {
    this.activeConversationId = '';
  }

  addMessage(conversationId: string, input: CreateAiMessageInput): AiMessage {
    const message: AiMessage = {
      id: this.createClientId('message'),
      role: input.role,
      content: input.content,
      rawContent: input.rawContent,
      createdAt: new Date().toISOString(),
      codeBlocks: input.codeBlocks,
      suggestions: input.suggestions,
      isCommand: input.isCommand,
      referencedExecutionIds: input.referencedExecutionIds
    };

    this.conversations = this.conversations.map((conversation) => {
      if (conversation.id !== conversationId) {
        return conversation;
      }

      return {
        ...conversation,
        title: this.getNextTitle(conversation, message),
        messages: [...conversation.messages, message],
        updatedAt: message.createdAt
      };
    });

    this.schedulePersistConversation(conversationId);
    return message;
  }

  addMessageToActiveConversation(input: CreateAiMessageInput): AiMessage | undefined {
    const activeConversation = this.getActiveConversation();
    if (!activeConversation) {
      return undefined;
    }

    return this.addMessage(activeConversation.id, input);
  }

  updateMessage(
    conversationId: string,
    messageId: string,
    patch: UpdateAiMessagePatch
  ): AiMessage | undefined {
    let updatedMessage: AiMessage | undefined;
    const updatedAt = new Date().toISOString();

    this.conversations = this.conversations.map((conversation) => {
      if (conversation.id !== conversationId) {
        return conversation;
      }

      return {
        ...conversation,
        messages: conversation.messages.map((message) => {
          if (message.id !== messageId) {
            return message;
          }

          updatedMessage = {
            ...message,
            ...patch
          };
          return updatedMessage;
        }),
        updatedAt
      };
    });

    if (updatedMessage) {
      this.schedulePersistConversation(conversationId);
    }

    return updatedMessage;
  }

  createCommandExecution(input: CreateCommandExecutionInput): CommandExecution | undefined {
    const conversation = this.getConversation(input.conversationId);
    if (!conversation) {
      return undefined;
    }

    const now = new Date().toISOString();
    const execution: CommandExecution = {
      id: this.createClientId('execution'),
      conversationId: input.conversationId,
      suggestionId: input.suggestionId,
      terminalSessionId: input.terminalSessionId,
      command: input.command,
      status: 'pending',
      rawOutput: '',
      outputPreview: '',
      includedInContext: false,
      contextMode: 'none',
      collapsed: true,
      startedAt: now
    };

    this.conversations = this.conversations.map((currentConversation) =>
      currentConversation.id === input.conversationId
        ? {
            ...currentConversation,
            executions: [...currentConversation.executions, execution],
            updatedAt: now
          }
        : currentConversation
    );

    this.schedulePersistConversation(input.conversationId);
    return execution;
  }

  markCommandExecutionRunning(executionId: string): CommandExecution | undefined {
    const execution = this.updateCommandExecutionStatus(executionId, 'running');
    if (execution) {
      this.runningExecutionIdsByTerminalSession.set(execution.terminalSessionId, execution.id);
    }

    return execution;
  }

  markCommandExecutionFailed(
    executionId: string,
    patch: Partial<CommandExecution> = {}
  ): CommandExecution | undefined {
    const execution = this.updateCommandExecutionStatus(executionId, 'failed', {
      ...patch,
      finishedAt: new Date().toISOString()
    });

    if (execution) {
      this.removeRunningExecutionReference(execution.id);
    }

    return execution;
  }

  completeCommandExecution(
    executionId: string,
    rawOutput: string,
    exitCode?: number
  ): CommandExecution | undefined {
    const normalizedOutput = rawOutput.trim();
    const patch: Partial<CommandExecution> = {
      rawOutput: normalizedOutput,
      outputPreview: this.createOutputPreview(normalizedOutput),
      includedInContext: true,
      contextMode: 'full',
      collapsed: true,
      finishedAt: new Date().toISOString()
    };

    if (typeof exitCode === 'number') {
      patch.exitCode = exitCode;
    }

    const execution = this.updateCommandExecutionStatus(
      executionId,
      typeof exitCode === 'number' && exitCode !== 0 ? 'failed' : 'success',
      patch
    );

    if (execution) {
      this.removeRunningExecutionReference(execution.id);
    }

    return execution;
  }

  updateCommandExecution(
    executionId: string,
    patch: Partial<CommandExecution>
  ): CommandExecution | undefined {
    let updatedExecution: CommandExecution | undefined;
    let updatedConversationId = '';
    const updatedAt = new Date().toISOString();

    this.conversations = this.conversations.map((conversation) => {
      let didUpdateConversation = false;
      const executions = conversation.executions.map((execution) => {
        if (execution.id !== executionId) {
          return execution;
        }

        didUpdateConversation = true;
        updatedExecution = {
          ...execution,
          ...patch
        };
        updatedConversationId = conversation.id;
        return updatedExecution;
      });

      return didUpdateConversation
        ? {
            ...conversation,
            executions,
            updatedAt
          }
        : conversation;
    });

    if (updatedConversationId) {
      this.schedulePersistConversation(updatedConversationId);
    }

    return updatedExecution;
  }

  removeCommandExecution(executionId: string): boolean {
    let didRemoveExecution = false;
    const updatedConversationIds: string[] = [];
    const updatedAt = new Date().toISOString();

    this.conversations = this.conversations.map((conversation) => {
      const executions = conversation.executions.filter((execution) => execution.id !== executionId);
      if (executions.length === conversation.executions.length) {
        return conversation;
      }

      didRemoveExecution = true;
      updatedConversationIds.push(conversation.id);
      return {
        ...conversation,
        executions,
        updatedAt
      };
    });

    if (didRemoveExecution) {
      this.removeRunningExecutionReference(executionId);
      updatedConversationIds.forEach((conversationId) => this.schedulePersistConversation(conversationId));
    }

    return didRemoveExecution;
  }

  shouldIncludeExecutionInContext(execution: CommandExecution): boolean {
    return (
      execution.includedInContext &&
      execution.contextMode !== 'none' &&
      execution.status !== 'pending' &&
      execution.status !== 'running' &&
      Boolean(this.getCommandExecutionContextOutput(execution).trim())
    );
  }

  getCommandExecutionContextOutput(execution: CommandExecution): string {
    if (execution.contextMode === 'summary') {
      return execution.outputSummary || execution.outputPreview || '';
    }

    if (execution.contextMode === 'selected') {
      return execution.selectedOutput || '';
    }

    return execution.editableOutput ?? execution.rawOutput;
  }

  buildCommandExecutionContextText(execution: CommandExecution): string {
    const output = this.truncateText(
      this.getCommandExecutionContextOutput(execution),
      this.executionContextSingleOutputMaxChars
    );
    const exitCodeText = typeof execution.exitCode === 'number' ? String(execution.exitCode) : 'unknown';
    const finishedAtText = execution.finishedAt || 'unknown';

    return [
      `Command: ${execution.command}`,
      `Status: ${execution.status}`,
      `Exit code: ${exitCodeText}`,
      `Finished at: ${finishedAtText}`,
      'Output:',
      output || '(no output)'
    ].join('\n');
  }

  buildExecutionContextText(conversation?: AiConversation): string {
    if (!conversation) {
      return '';
    }

    const eligibleExecutions = conversation.executions
      .filter((execution) => this.shouldIncludeExecutionInContext(execution))
      .slice(-8);

    if (eligibleExecutions.length === 0) {
      return '';
    }

    let remainingChars = this.executionContextMaxChars;
    const blocks: string[] = [];

    for (const execution of eligibleExecutions) {
      const block = this.buildCommandExecutionContextText(execution);
      const separator = blocks.length === 0 ? '' : '\n\n---\n\n';
      const requiredChars = separator.length + block.length;

      if (requiredChars <= remainingChars) {
        blocks.push(`${separator}${block}`);
        remainingChars -= requiredChars;
        continue;
      }

      if (remainingChars > 240) {
        blocks.push(`${separator}${this.truncateText(block, remainingChars)}`);
      }
      break;
    }

    if (blocks.length === 0) {
      return '';
    }

    return [
      'Command execution attachments for this conversation:',
      blocks.join('')
    ].join('\n\n');
  }

  getRunningExecutionForTerminalSession(terminalSessionId: string): CommandExecution | undefined {
    const executionId = this.runningExecutionIdsByTerminalSession.get(terminalSessionId);
    if (!executionId) {
      return undefined;
    }

    return this.conversations
      .flatMap((conversation) => conversation.executions)
      .find((execution) => execution.id === executionId && execution.status === 'running');
  }

  clearActiveConversationMessages(): void {
    const activeConversation = this.getActiveConversation();
    if (!activeConversation) {
      return;
    }

    this.deleteConversation(activeConversation.id);
  }

  deleteConversation(conversationId: string): boolean {
    const conversation = this.getConversation(conversationId);
    if (!conversation) {
      return false;
    }

    for (const execution of conversation.executions) {
      this.removeRunningExecutionReference(execution.id);
    }

    this.conversations = this.conversations.filter((currentConversation) => currentConversation.id !== conversationId);
    if (this.activeConversationId === conversationId) {
      this.activeConversationId = '';
    }
    this.scheduleDeletePersistedConversation(conversationId);
    return true;
  }

  removeMessageTurn(conversationId: string, messageId: string): boolean {
    const conversation = this.getConversation(conversationId);
    if (!conversation) {
      return false;
    }

    const messageIndex = conversation.messages.findIndex((message) => message.id === messageId);
    if (messageIndex === -1) {
      return false;
    }

    const messageIdsToRemove = new Set<string>();
    const targetMessage = conversation.messages[messageIndex];
    if (targetMessage.role === 'user') {
      messageIdsToRemove.add(targetMessage.id);
      const nextMessage = conversation.messages[messageIndex + 1];
      if (nextMessage?.role === 'assistant') {
        messageIdsToRemove.add(nextMessage.id);
      }
    } else if (targetMessage.role === 'assistant') {
      const previousMessage = conversation.messages[messageIndex - 1];
      if (previousMessage?.role === 'user') {
        messageIdsToRemove.add(previousMessage.id);
      }
      messageIdsToRemove.add(targetMessage.id);
    } else {
      messageIdsToRemove.add(targetMessage.id);
    }

    const suggestionIdsToRemove = new Set(
      conversation.messages
        .filter((message) => messageIdsToRemove.has(message.id))
        .flatMap((message) => message.suggestions || [])
        .map((suggestion) => suggestion.id)
    );
    const executionIdsToRemove = new Set(
      conversation.executions
        .filter((execution) => execution.suggestionId && suggestionIdsToRemove.has(execution.suggestionId))
        .map((execution) => execution.id)
    );

    for (const executionId of executionIdsToRemove) {
      this.removeRunningExecutionReference(executionId);
    }

    const nextMessages = conversation.messages.filter((message) => !messageIdsToRemove.has(message.id));
    if (nextMessages.length === 0) {
      return this.deleteConversation(conversationId);
    }

    const updatedAt = new Date().toISOString();
    const nextExecutions = conversation.executions.filter((execution) => !executionIdsToRemove.has(execution.id));
    this.conversations = this.conversations.map((currentConversation) =>
      currentConversation.id === conversationId
        ? {
            ...currentConversation,
            title: this.getTitleAfterMessageDeletion(currentConversation.title, nextMessages),
            messages: nextMessages,
            executions: nextExecutions,
            updatedAt
          }
        : currentConversation
    );
    this.schedulePersistConversation(conversationId);
    return true;
  }

  private updateCommandExecutionStatus(
    executionId: string,
    status: CommandExecutionStatus,
    patch: Partial<CommandExecution> = {}
  ): CommandExecution | undefined {
    let updatedExecution: CommandExecution | undefined;
    let updatedConversationId = '';
    const updatedAt = new Date().toISOString();

    this.conversations = this.conversations.map((conversation) => {
      let didUpdateConversation = false;
      const executions = conversation.executions.map((execution) => {
        if (execution.id !== executionId) {
          return execution;
        }

        didUpdateConversation = true;
        updatedExecution = {
          ...execution,
          ...patch,
          status
        };
        updatedConversationId = conversation.id;
        return updatedExecution;
      });

      return didUpdateConversation
        ? {
            ...conversation,
            executions,
            updatedAt
          }
        : conversation;
    });

    if (updatedConversationId) {
      this.schedulePersistConversation(updatedConversationId);
    }

    return updatedExecution;
  }

  private removeRunningExecutionReference(executionId: string): void {
    for (const [terminalSessionId, runningExecutionId] of this.runningExecutionIdsByTerminalSession.entries()) {
      if (runningExecutionId === executionId) {
        this.runningExecutionIdsByTerminalSession.delete(terminalSessionId);
      }
    }
  }

  private createOutputPreview(rawOutput: string): string {
    const output = rawOutput.trim();
    if (!output) {
      return '(no output)';
    }

    const lines = output.split('\n');
    const preview = lines.slice(0, 6).join('\n');
    const suffix = lines.length > 6 || preview.length < output.length ? '\n...' : '';
    return this.truncateText(`${preview}${suffix}`, 700);
  }

  private truncateText(text: string, maxChars: number): string {
    if (text.length <= maxChars) {
      return text;
    }

    return `${text.slice(0, Math.max(0, maxChars - 34)).trimEnd()}\n...[truncated]`;
  }

  private getNextTitle(conversation: AiConversation, message: AiMessage): string {
    if (message.role !== 'user' || conversation.messages.length > 0) {
      return conversation.title;
    }

    const trimmedContent = message.content.trim();
    if (!trimmedContent) {
      return conversation.title;
    }

    return trimmedContent.length > 42
      ? `${trimmedContent.slice(0, 39)}...`
      : trimmedContent;
  }

  private createClientId(prefix: string): string {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  private getTitleAfterMessageDeletion(currentTitle: string, messages: AiMessage[]): string {
    const firstUserMessage = messages.find((message) => message.role === 'user' && message.content.trim());
    if (!firstUserMessage) {
      return currentTitle;
    }

    const trimmedContent = firstUserMessage.content.trim();
    return trimmedContent.length > 42
      ? `${trimmedContent.slice(0, 39)}...`
      : trimmedContent;
  }

  private schedulePersistConversation(conversationId: string): void {
    if (this.deletedConversationIds.has(conversationId)) {
      return;
    }

    const previousPersist = this.persistQueuesByConversationId.get(conversationId) || Promise.resolve();
    const nextPersist = previousPersist
      .catch(() => undefined)
      .then(async () => {
        if (this.deletedConversationIds.has(conversationId)) {
          return;
        }

        const conversation = this.getConversation(conversationId);
        if (!conversation) {
          return;
        }

        await invoke<string>('save_ai_conversation', { conversation });
      })
      .catch((error) => {
        console.error(`Failed to save AI conversation ${conversationId}:`, error);
      });

    this.persistQueuesByConversationId.set(conversationId, nextPersist);
    void nextPersist.finally(() => {
      if (this.persistQueuesByConversationId.get(conversationId) === nextPersist) {
        this.persistQueuesByConversationId.delete(conversationId);
      }
    });
  }

  private scheduleDeletePersistedConversation(conversationId: string): void {
    this.deletedConversationIds.add(conversationId);
    const previousPersist = this.persistQueuesByConversationId.get(conversationId) || Promise.resolve();
    const deletePersist = previousPersist
      .catch(() => undefined)
      .then(() => invoke<void>('delete_ai_conversation', { conversationId }))
      .catch((error) => {
        console.error(`Failed to delete AI conversation ${conversationId}:`, error);
      });

    this.persistQueuesByConversationId.set(conversationId, deletePersist);
    void deletePersist.finally(() => {
      if (this.persistQueuesByConversationId.get(conversationId) === deletePersist) {
        this.persistQueuesByConversationId.delete(conversationId);
      }
      this.deletedConversationIds.delete(conversationId);
    });
  }

  private normalizeConversation(value: unknown): AiConversation | undefined {
    const rawConversation = value as Partial<AiConversation> | null | undefined;
    if (!rawConversation || typeof rawConversation.id !== 'string') {
      return undefined;
    }

    const messages = Array.isArray(rawConversation.messages)
      ? rawConversation.messages.map((message) => this.normalizeMessage(message)).filter((message): message is AiMessage => Boolean(message))
      : [];
    const executions = Array.isArray(rawConversation.executions)
      ? rawConversation.executions
          .map((execution) => this.normalizeCommandExecution(execution, rawConversation.id!))
          .filter((execution): execution is CommandExecution => Boolean(execution))
      : [];
    const now = new Date().toISOString();

    return {
      id: rawConversation.id,
      title: typeof rawConversation.title === 'string' && rawConversation.title.trim()
        ? rawConversation.title
        : 'Restored chat',
      terminalSessionId: typeof rawConversation.terminalSessionId === 'string' && rawConversation.terminalSessionId.trim()
        ? rawConversation.terminalSessionId
        : 'restored-terminal-session',
      status: rawConversation.status === 'archived' ? 'archived' : 'active',
      messages,
      executions,
      createdAt: typeof rawConversation.createdAt === 'string' ? rawConversation.createdAt : now,
      updatedAt: typeof rawConversation.updatedAt === 'string' ? rawConversation.updatedAt : now
    };
  }

  private normalizeMessage(value: unknown): AiMessage | undefined {
    const rawMessage = value as Partial<AiMessage> | null | undefined;
    if (!rawMessage || typeof rawMessage.id !== 'string') {
      return undefined;
    }

    const role = rawMessage.role === 'assistant' || rawMessage.role === 'system'
      ? rawMessage.role
      : 'user';

    return {
      id: rawMessage.id,
      role,
      content: typeof rawMessage.content === 'string' ? rawMessage.content : '',
      rawContent: typeof rawMessage.rawContent === 'string' ? rawMessage.rawContent : undefined,
      createdAt: typeof rawMessage.createdAt === 'string' ? rawMessage.createdAt : new Date().toISOString(),
      codeBlocks: Array.isArray(rawMessage.codeBlocks) ? rawMessage.codeBlocks : undefined,
      suggestions: Array.isArray(rawMessage.suggestions) ? rawMessage.suggestions : undefined,
      isCommand: Boolean(rawMessage.isCommand),
      referencedExecutionIds: Array.isArray(rawMessage.referencedExecutionIds) ? rawMessage.referencedExecutionIds : undefined
    };
  }

  private normalizeCommandExecution(value: unknown, conversationId: string): CommandExecution | undefined {
    const rawExecution = value as Partial<CommandExecution> | null | undefined;
    if (!rawExecution || typeof rawExecution.id !== 'string' || typeof rawExecution.command !== 'string') {
      return undefined;
    }

    const status = this.isCommandExecutionStatus(rawExecution.status) ? rawExecution.status : 'success';
    const contextMode = rawExecution.contextMode === 'summary' || rawExecution.contextMode === 'selected' || rawExecution.contextMode === 'full'
      ? rawExecution.contextMode
      : 'none';
    const now = new Date().toISOString();

    return {
      id: rawExecution.id,
      conversationId: typeof rawExecution.conversationId === 'string' ? rawExecution.conversationId : conversationId,
      suggestionId: typeof rawExecution.suggestionId === 'string' ? rawExecution.suggestionId : undefined,
      terminalSessionId: typeof rawExecution.terminalSessionId === 'string' ? rawExecution.terminalSessionId : 'restored-terminal-session',
      command: rawExecution.command,
      status,
      exitCode: typeof rawExecution.exitCode === 'number' ? rawExecution.exitCode : undefined,
      rawOutput: typeof rawExecution.rawOutput === 'string' ? rawExecution.rawOutput : '',
      editableOutput: typeof rawExecution.editableOutput === 'string' ? rawExecution.editableOutput : undefined,
      outputPreview: typeof rawExecution.outputPreview === 'string' ? rawExecution.outputPreview : '',
      outputSummary: typeof rawExecution.outputSummary === 'string' ? rawExecution.outputSummary : undefined,
      includedInContext: Boolean(rawExecution.includedInContext),
      contextMode,
      selectedOutput: typeof rawExecution.selectedOutput === 'string' ? rawExecution.selectedOutput : undefined,
      collapsed: rawExecution.collapsed !== false,
      startedAt: typeof rawExecution.startedAt === 'string' ? rawExecution.startedAt : now,
      finishedAt: typeof rawExecution.finishedAt === 'string' ? rawExecution.finishedAt : undefined
    };
  }

  private isCommandExecutionStatus(value: unknown): value is CommandExecutionStatus {
    return value === 'pending' || value === 'running' || value === 'success' || value === 'failed' || value === 'cancelled';
  }
}
