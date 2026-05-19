import { Injectable } from '@angular/core';

export interface ParsedCommandPart {
  command: string;
  fullText: string;
}

export interface ExtractedCodeBlock {
  code: string;
  language: string;
}

export interface ExtractCodeBlocksResult {
  formattedText: string;
  codeBlocks: ExtractedCodeBlock[];
}

@Injectable({
  providedIn: 'root'
})
export class AiResponseFormatService {
  parseCommandFromResponse(response: string): ParsedCommandPart[] {
    return response ? [{ command: '', fullText: this.processSingleBackticks(response) }] : [];
  }

  extractCodeBlocks(text: string): ExtractCodeBlocksResult {
    return {
      formattedText: this.processSingleBackticks(text),
      codeBlocks: []
    };
  }

  isSimpleCommand(code: string): boolean {
    if (!code) {
      return false;
    }

    const cleanCode = code.replace(/```/g, '').trim();

    if (cleanCode.length < 100 && !cleanCode.includes('\n')) {
      if (cleanCode.split(' ').length <= 5) {
        return true;
      }
    }

    const isSimple =
      !cleanCode.includes('\n') &&
      !cleanCode.includes('|') &&
      !cleanCode.includes('>') &&
      !cleanCode.includes('<') &&
      !cleanCode.includes('=') &&
      cleanCode.length < 80;

    const isCommonCommand =
      cleanCode.startsWith('ls') ||
      cleanCode.startsWith('cd') ||
      cleanCode.startsWith('mkdir') ||
      cleanCode.startsWith('rm') ||
      cleanCode.startsWith('cp') ||
      cleanCode.startsWith('mv') ||
      cleanCode.startsWith('cat') ||
      cleanCode.startsWith('grep') ||
      cleanCode.startsWith('find') ||
      cleanCode.startsWith('echo');

    return isSimple && (isCommonCommand || cleanCode.split(' ').length <= 3);
  }

  isCodeBlockPlaceholder(text: string): boolean {
    const exactMatch = /^<code-block-\d+><\/code-block-\d+>$/.test(text);
    if (exactMatch) {
      return true;
    }
    return text.trim().startsWith('<code-block-') && text.trim().includes('>');
  }

  getCodeBlockIndex(placeholder: string): number {
    let match = placeholder.match(/<code-block-(\d+)><\/code-block-\d+>/);
    if (!match) {
      match = placeholder.match(/<code-block-(\d+)>/);
    }
    return match ? parseInt(match[1], 10) : -1;
  }

  getCommandExplanation(code: string): string | null {
    if (!code) {
      return null;
    }

    return this.splitCommandAndExplanation(code).explanation;
  }

  transformCodeForDisplay(code: string): string {
    if (!code) {
      return '';
    }

    return this.splitCommandAndExplanation(code).command;
  }

  private splitCommandAndExplanation(code: string): { command: string; explanation: string | null } {
    let cleanCode = code.replace(/```/g, '').trim();
    const lines = cleanCode.split('\n');
    if (lines.length > 1 && this.isLikelyCodeFenceLanguage(lines[0])) {
      cleanCode = lines.slice(1).join('\n').trim();
    }

    const separatorIndex = this.findInlineExplanationSeparator(cleanCode);
    if (separatorIndex < 0) {
      return { command: cleanCode, explanation: null };
    }

    const command = cleanCode.slice(0, separatorIndex).trim();
    const explanation = cleanCode.slice(separatorIndex + 1).trim();
    return {
      command: command || cleanCode,
      explanation: command && explanation ? explanation : null
    };
  }

  private findInlineExplanationSeparator(value: string): number {
    let quote: string | null = null;
    let escaped = false;

    for (let index = 0; index < value.length; index += 1) {
      const char = value[index];

      if (escaped) {
        escaped = false;
        continue;
      }

      if (char === '\\') {
        escaped = true;
        continue;
      }

      if (quote) {
        if (char === quote) {
          quote = null;
        }
        continue;
      }

      if (char === '\'' || char === '"' || char === '`') {
        quote = char;
        continue;
      }

      if (char !== ':' && char !== '：') {
        continue;
      }

      const previousChar = value[index - 1] || '';
      const nextChar = value[index + 1] || '';
      if (!previousChar || /\s/.test(previousChar) || !nextChar || !/\s/.test(nextChar)) {
        continue;
      }

      return index;
    }

    return -1;
  }

  private isLikelyCodeFenceLanguage(value: string): boolean {
    const language = value.trim();
    return /^[A-Za-z][A-Za-z0-9_-]{0,19}$/.test(language);
  }

  private processSingleBackticks(text: string): string {
    return text.replace(/`([^`]+)`/g, '<b>$1</b>');
  }
}
