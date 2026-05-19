import { Injectable } from '@angular/core';

export type CommandTagRisk = 'safe' | 'caution' | 'danger';

export interface ParsedCommandTag {
  title: string;
  command: string;
  risk: CommandTagRisk;
  raw: string;
}

export interface CommandTagFormattingResult {
  formattedText: string;
  commands: ParsedCommandTag[];
}

const CMD_TAG_REGEX = /<CMD\b([^>]*)>([\s\S]*?)<\/CMD>/g;

@Injectable({
  providedIn: 'root'
})
export class CommandTagParserService {
  parseCommandTags(content: string): ParsedCommandTag[] {
    return this.formatContentWithCommandTags(content).commands;
  }

  formatContentWithCommandTags(content: string): CommandTagFormattingResult {
    const commands: ParsedCommandTag[] = [];
    let formattedText = '';
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    CMD_TAG_REGEX.lastIndex = 0;
    while ((match = CMD_TAG_REGEX.exec(content)) !== null) {
      const raw = match[0];
      const attrs = match[1] || '';
      const commandText = match[2] || '';
      formattedText += content.slice(lastIndex, match.index);

      const parsedCommand = this.parseCommandTag(attrs, commandText, raw);
      if (parsedCommand) {
        const placeholder = `<code-block-${commands.length}></code-block-${commands.length}>`;
        commands.push(parsedCommand);
        formattedText += this.wrapPlaceholderWithNewlines(formattedText, content, CMD_TAG_REGEX.lastIndex, placeholder);
      } else {
        formattedText += this.escapeHtml(raw);
      }

      lastIndex = CMD_TAG_REGEX.lastIndex;
    }

    formattedText += content.slice(lastIndex);

    return {
      formattedText,
      commands
    };
  }

  private parseCommandTag(attrs: string, commandText: string, raw: string): ParsedCommandTag | null {
    const command = commandText.trim();
    if (!command || /[\r\n]/.test(command)) {
      return null;
    }

    const parsedAttrs = this.parseAttributes(attrs);
    return {
      title: parsedAttrs['title']?.trim() || '命令',
      command,
      risk: this.normalizeRisk(parsedAttrs['risk']),
      raw
    };
  }

  private parseAttributes(attrs: string): Record<string, string> {
    const result: Record<string, string> = {};
    const attrRegex = /([A-Za-z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
    let match: RegExpExecArray | null;

    while ((match = attrRegex.exec(attrs)) !== null) {
      result[match[1].toLowerCase()] = match[2] ?? match[3] ?? '';
    }

    return result;
  }

  private normalizeRisk(risk?: string): CommandTagRisk {
    if (risk === 'safe' || risk === 'danger') {
      return risk;
    }

    return 'caution';
  }

  private wrapPlaceholderWithNewlines(
    currentText: string,
    originalContent: string,
    nextIndex: number,
    placeholder: string
  ): string {
    const prefix = currentText.endsWith('\n') || currentText.length === 0 ? '' : '\n';
    const suffix = originalContent[nextIndex] === '\n' || nextIndex >= originalContent.length ? '' : '\n';
    return `${prefix}${placeholder}${suffix}`;
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}
