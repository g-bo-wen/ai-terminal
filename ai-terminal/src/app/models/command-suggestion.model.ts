export type CommandRiskLevel = 'safe' | 'caution' | 'danger';

export interface CommandSuggestion {
  id: string;
  conversationId: string;
  messageId: string;
  title: string;
  command: string;
  explanation?: string;
  riskLevel: CommandRiskLevel;
  raw?: string;
  createdAt: string;
}
