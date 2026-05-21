import { Injectable } from '@angular/core';

export interface AiCommandContext {
  currentLLMModel: string;
  apiBaseUrl: string;
  apiKey: string;
  availableModels: string[];
  setCurrentLLMModel: (model: string) => void;
  setApiBaseUrl: (host: string) => string;
  setAvailableModels: (models: string[]) => void;
  loadModels: () => Promise<string[]>;
  saveSettings: () => void;
  clearChatHistory: () => void;
  getAiLogFilePath: () => Promise<string>;
  testOpenAiConnection: () => void;
  retryOpenAiConnection: () => Promise<void>;
}

@Injectable({
  providedIn: 'root'
})
export class AiCommandService {
  async handleAICommand(command: string, context: AiCommandContext): Promise<string> {
    const parts = command.split(' ');
    const cmd = parts[0].toLowerCase();

    switch (cmd) {
      case '/help':
        return `
Available commands:
/help - Show this help message
/models - List available models
/model [name] - Show current model or switch to a different model
/host [url] - Show current API host or set a new one
/retry - Retry connection to the OpenAI compatible API
/logs - Show AI chat log directory
/clear - Clear the AI chat history`;

      case '/models':
        try {
          const models = await context.loadModels();
          context.setAvailableModels(models);
          let result = 'Available models:\n';
          if (models.length === 0) {
            result += '- No models returned. You can still enter a model manually in Settings.\n';
          }
          for (const model of models) {
            result += `- ${model}\n`;
          }
          return result;
        } catch (error) {
          return `Error: Failed to get models from OpenAI compatible API: ${error}`;
        }

      case '/model':
        if (parts.length > 1) {
          const modelName = parts.slice(1).join(' ');
          try {
            context.setCurrentLLMModel(modelName);
            context.saveSettings();
            return `Switched to model: ${modelName}`;
          } catch (error) {
            return `Error: Failed to switch model: ${error}`;
          }
        }
        return `Current model: ${context.currentLLMModel}`;

      case '/host':
        if (parts.length > 1) {
          const hostUrl = parts.slice(1).join(' ');
          try {
            const normalizedHost = context.setApiBaseUrl(hostUrl);
            context.saveSettings();
            setTimeout(() => context.testOpenAiConnection(), 100);
            return `Changed OpenAI compatible API host to: ${normalizedHost}`;
          } catch (error) {
            return `Error: Failed to set host: ${error}`;
          }
        }
        return `Current OpenAI compatible API host: ${context.apiBaseUrl}`;

      case '/retry':
        setTimeout(() => {
          void context.retryOpenAiConnection();
        }, 100);
        return 'Attempting to reconnect to the OpenAI compatible API...';

      case '/logs':
        try {
          return `AI chat log directory: ${await context.getAiLogFilePath()}`;
        } catch (error) {
          return `Error: Failed to get AI chat log directory: ${error}`;
        }

      case '/clear':
        context.clearChatHistory();
        return 'AI chat history cleared';

      default:
        return `Unknown command: ${cmd}. Type /help for available commands.`;
    }
  }
}
