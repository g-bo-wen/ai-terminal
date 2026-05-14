import { Injectable } from '@angular/core';
import { AiCodeBlock, AiConversation, AiMessage } from '../models/ai-conversation.model';
import { CommandExecution, CommandExecutionStatus } from '../models/command-execution.model';
import { CommandSuggestion } from '../models/command-suggestion.model';

export interface CreateAiMessageInput {
  role: AiMessage['role'];
  content: string;
  codeBlocks?: AiCodeBlock[];
  suggestions?: CommandSuggestion[];
  isCommand?: boolean;
  referencedExecutionIds?: string[];
}

export interface UpdateAiMessagePatch {
  content?: string;
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
  private readonly executionContextMaxChars = 8000;
  private readonly executionContextSingleOutputMaxChars = 3000;
  private conversations: AiConversation[] = [];
  private activeConversationId = '';
  private runningExecutionIdsByTerminalSession = new Map<string, string>();

  listConversations(): AiConversation[] {
    return this.conversations.filter((conversation) => conversation.status === 'active');
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

    return updatedExecution;
  }

  removeCommandExecution(executionId: string): boolean {
    let didRemoveExecution = false;
    const updatedAt = new Date().toISOString();

    this.conversations = this.conversations.map((conversation) => {
      const executions = conversation.executions.filter((execution) => execution.id !== executionId);
      if (executions.length === conversation.executions.length) {
        return conversation;
      }

      didRemoveExecution = true;
      return {
        ...conversation,
        executions,
        updatedAt
      };
    });

    if (didRemoveExecution) {
      this.removeRunningExecutionReference(executionId);
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

    const executionIdsToRemove = new Set(activeConversation.executions.map((execution) => execution.id));
    for (const executionId of executionIdsToRemove) {
      this.removeRunningExecutionReference(executionId);
    }

    const updatedAt = new Date().toISOString();
    this.conversations = this.conversations.map((conversation) =>
      conversation.id === activeConversation.id
        ? {
            ...conversation,
            messages: [],
            executions: [],
            updatedAt
          }
        : conversation
    );
  }

  private updateCommandExecutionStatus(
    executionId: string,
    status: CommandExecutionStatus,
    patch: Partial<CommandExecution> = {}
  ): CommandExecution | undefined {
    let updatedExecution: CommandExecution | undefined;
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
}
