export type CommandRiskLevel = 'safe' | 'review' | 'dangerous';

export interface CommandSuggestion {
  id: string;
  conversationId: string;
  messageId: string;
  command: string;
  explanation?: string;
  riskLevel: CommandRiskLevel;
  createdAt: string;
}
