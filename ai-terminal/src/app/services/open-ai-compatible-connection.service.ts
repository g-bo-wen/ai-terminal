import { Injectable } from '@angular/core';
import { ChatHistory } from '../models/chat-history.model';

export interface OpenAiConnectionContext {
  apiBaseUrl: string;
  apiKey: string;
  currentLLMModel: string;
  setCurrentLLMModel: (model: string) => void;
  setAvailableModels?: (models: string[]) => void;
  addChatEntry: (entry: ChatHistory) => void;
}

@Injectable({
  providedIn: 'root'
})
export class OpenAiCompatibleConnectionService {
  normalizeBaseUrl(baseUrl: string): string {
    const trimmed = baseUrl.trim().replace(/\/+$/, '');
    if (!trimmed) {
      return 'https://api.openai.com/v1';
    }

    return trimmed.endsWith('/v1') ? trimmed : `${trimmed}/v1`;
  }

  async loadModels(apiBaseUrl: string, apiKey: string): Promise<string[]> {
    const normalizedBaseUrl = this.normalizeBaseUrl(apiBaseUrl);
    const response = await fetch(`${normalizedBaseUrl}/models`, {
      method: 'GET',
      headers: this.buildHeaders(apiKey)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI compatible API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    if (!Array.isArray(data?.data)) {
      throw new Error('Unexpected models response format');
    }

    return data.data
      .map((model: any) => model?.id)
      .filter((id: unknown): id is string => typeof id === 'string' && id.trim().length > 0);
  }

  async testOpenAiConnection(context: OpenAiConnectionContext): Promise<void> {
    if (!context.apiKey.trim()) {
      context.addChatEntry({
        message: 'System',
        response: 'OpenAI compatible API key is not configured. Open Settings and add a key before chatting.',
        timestamp: new Date(),
        isCommand: true
      });
      return;
    }

    try {
      const models = await this.loadModels(context.apiBaseUrl, context.apiKey);
      context.setAvailableModels?.(models);

      if (models.length === 0) {
        context.addChatEntry({
          message: 'System',
          response: 'Connected to the OpenAI compatible API, but no models were returned. You can still enter a model manually in Settings.',
          timestamp: new Date(),
          isCommand: true
        });
        return;
      }

      if (!context.currentLLMModel.trim()) {
        const selectedModel = models[0];
        context.setCurrentLLMModel(selectedModel);
        context.addChatEntry({
          message: 'System',
          response: `Connected to the OpenAI compatible API. Using model: ${selectedModel}`,
          timestamp: new Date(),
          isCommand: true
        });
      } else if (models.includes(context.currentLLMModel)) {
        context.addChatEntry({
          message: 'System',
          response: `Connected to the OpenAI compatible API. Using model: ${context.currentLLMModel}`,
          timestamp: new Date(),
          isCommand: true
        });
      } else {
        context.addChatEntry({
          message: 'System',
          response: `Connected to the OpenAI compatible API. Current model '${context.currentLLMModel}' was not in the loaded list, but it will remain selected for manual use.`,
          timestamp: new Date(),
          isCommand: true
        });
      }
    } catch (error) {
      console.error('Error testing OpenAI compatible connection:', error);
      context.addChatEntry({
        message: 'System',
        response: `Could not connect to the OpenAI compatible API at ${context.apiBaseUrl}. Check the endpoint, key, and model settings.`,
        timestamp: new Date(),
        isCommand: true
      });
    }
  }

  async retryOpenAiConnection(context: OpenAiConnectionContext): Promise<void> {
    context.addChatEntry({
      message: 'System',
      response: 'Retrying connection to the OpenAI compatible API...',
      timestamp: new Date(),
      isCommand: true
    });
    await this.testOpenAiConnection(context);
  }

  private buildHeaders(apiKey: string): HeadersInit {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };

    if (apiKey.trim()) {
      headers['Authorization'] = `Bearer ${apiKey.trim()}`;
    }

    return headers;
  }
}
