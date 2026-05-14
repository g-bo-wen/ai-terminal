export type CommandExecutionStatus = 'pending' | 'running' | 'success' | 'failed' | 'cancelled';

export type CommandExecutionContextMode = 'none' | 'summary' | 'selected' | 'full';

export interface CommandExecution {
  id: string;
  conversationId: string;
  suggestionId?: string;
  terminalSessionId: string;
  command: string;
  status: CommandExecutionStatus;
  exitCode?: number;
  rawOutput: string;
  editableOutput?: string;
  outputPreview: string;
  outputSummary?: string;
  includedInContext: boolean;
  contextMode: CommandExecutionContextMode;
  selectedOutput?: string;
  collapsed: boolean;
  startedAt: string;
  finishedAt?: string;
}
