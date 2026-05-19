import { CommandSuggestion } from './command-suggestion.model';
import { CommandExecution } from './command-execution.model';

export interface AiCodeBlock {
  code: string;
  language: string;
}

export interface AiMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  rawContent?: string;
  createdAt: string;
  codeBlocks?: AiCodeBlock[];
  suggestions?: CommandSuggestion[];
  isCommand?: boolean;
  referencedExecutionIds?: string[];
}

export interface AiConversation {
  id: string;
  title: string;
  terminalSessionId: string;
  status: 'active' | 'archived';
  messages: AiMessage[];
  executions: CommandExecution[];
  createdAt: string;
  updatedAt: string;
}
