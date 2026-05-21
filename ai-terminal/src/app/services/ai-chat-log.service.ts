import { Injectable } from '@angular/core';
import { invoke } from '@tauri-apps/api/core';

export type AiChatLogPhase = 'request' | 'response' | 'error';

export interface AiChatLogEvent {
  requestId: string;
  phase: AiChatLogPhase;
  operation: string;
  timestamp: string;
  endpoint?: string;
  model?: string;
  conversationId?: string;
  messageId?: string;
  data?: unknown;
}

@Injectable({
  providedIn: 'root'
})
export class AiChatLogService {
  private logFilePathPromise?: Promise<string>;
  private logDirectoryPathPromise?: Promise<string>;

  createRequestId(operation: string): string {
    return `${operation}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  async logEvent(event: AiChatLogEvent): Promise<void> {
    try {
      const logFilePath = await invoke<string>('write_ai_log_event', { event });
      this.logFilePathPromise = Promise.resolve(logFilePath);
    } catch (error) {
      console.error('Failed to write AI chat log:', error);
    }
  }

  async getLogFilePath(): Promise<string> {
    if (!this.logFilePathPromise) {
      this.logFilePathPromise = invoke<string>('get_ai_log_file_path');
    }

    return this.logFilePathPromise;
  }

  async getLogDirectoryPath(): Promise<string> {
    if (!this.logDirectoryPathPromise) {
      this.logDirectoryPathPromise = invoke<string>('get_ai_log_directory_path');
    }

    return this.logDirectoryPathPromise;
  }

  redactHeaders(headers: Record<string, string>): Record<string, string> {
    return Object.fromEntries(
      Object.entries(headers).map(([key, value]) => {
        if (key.toLowerCase() === 'authorization') {
          return [key, this.redactAuthorizationHeader(value)];
        }

        return [key, value];
      })
    );
  }

  serializeError(error: unknown): Record<string, unknown> {
    if (error instanceof Error) {
      return {
        name: error.name,
        message: error.message,
        stack: error.stack
      };
    }

    return {
      message: String(error)
    };
  }

  private redactAuthorizationHeader(value: string): string {
    const match = value.match(/^Bearer\s+(.+)$/i);
    if (!match) {
      return '[redacted]';
    }

    const token = match[1];
    const suffix = token.length > 4 ? token.slice(-4) : '';
    return suffix ? `Bearer [redacted]...${suffix}` : 'Bearer [redacted]';
  }
}
