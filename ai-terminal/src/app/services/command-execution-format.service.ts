import { Injectable } from '@angular/core';

export interface CommandExecutionCaptureContext {
  command: string;
  startMarker: string;
  doneMarker: string;
}

@Injectable({
  providedIn: 'root'
})
export class CommandExecutionFormatService {
  buildMarkedCommand(command: string, markerId: string, usePowerShellMarker: boolean): string {
    if (usePowerShellMarker) {
      return this.buildPowerShellMarkedCommand(command, markerId);
    }

    return this.buildPosixMarkedCommand(command, markerId);
  }

  shouldCollectCommandExecution(command: string): boolean {
    const trimmedCommand = command.trim();
    return Boolean(trimmedCommand) &&
      !/[\r\n]/.test(trimmedCommand) &&
      !this.isLikelyInteractiveCommand(trimmedCommand);
  }

  isPromptCompletionDetected(outputBuffer: string, command: string): boolean {
    const output = this.normalizeCapturedTerminalOutput(outputBuffer);
    const lines = output.split('\n');
    if (lines.length < 2) {
      return false;
    }

    const lastMeaningfulIndex = this.findLastMeaningfulLineIndex(lines);
    const lastMeaningfulLine = lastMeaningfulIndex >= 0 ? lines[lastMeaningfulIndex] : '';
    if (!this.isLikelyShellPromptLine(lastMeaningfulLine)) {
      return false;
    }

    return this.hasCapturedCommandEcho(lines, command) ||
      this.hasNonPromptContentBeforeLine(lines, lastMeaningfulIndex);
  }

  extractRawOutputFromPromptCompletion(context: CommandExecutionCaptureContext & { outputBuffer: string }): string {
    const output = this.normalizeCapturedTerminalOutput(context.outputBuffer);
    const lines = output.split('\n');
    const commandEchoIndex = lines.findIndex((line, index) =>
      index < 8 && this.isCommandEchoLine(line, context.command)
    );
    const outputLines = commandEchoIndex >= 0 ? lines.slice(commandEchoIndex + 1) : lines;

    while (outputLines.length > 0 && !outputLines[0].trim()) {
      outputLines.shift();
    }

    if (outputLines.length > 0 && this.isLikelyShellPromptLine(outputLines[0])) {
      outputLines.shift();
    }

    while (outputLines.length > 0 && !outputLines[0].trim()) {
      outputLines.shift();
    }

    while (outputLines.length > 0 && !outputLines[outputLines.length - 1].trim()) {
      outputLines.pop();
    }

    if (outputLines.length > 0 && this.isLikelyShellPromptLine(outputLines[outputLines.length - 1])) {
      outputLines.pop();
    }

    while (outputLines.length > 0 && !outputLines[outputLines.length - 1].trim()) {
      outputLines.pop();
    }

    return this.removeCapturedCommandNoise(outputLines.join('\n'), context);
  }

  parseExecutionExitCode(textAfterDoneMarker: string): number {
    const exitCodeMatch = textAfterDoneMarker.match(/^:(-?\d+)/);
    if (!exitCodeMatch) {
      return 1;
    }

    const exitCode = Number(exitCodeMatch[1]);
    return Number.isFinite(exitCode) ? exitCode : 1;
  }

  extractRawOutputBetweenMarkers(
    outputBeforeDoneMarker: string,
    context: CommandExecutionCaptureContext
  ): string {
    const startMarkerIndex = outputBeforeDoneMarker.indexOf(context.startMarker);
    const rawOutput = startMarkerIndex >= 0
      ? outputBeforeDoneMarker.slice(startMarkerIndex + context.startMarker.length)
      : outputBeforeDoneMarker;

    return this.removeCapturedCommandNoise(
      this.normalizeCapturedTerminalOutput(rawOutput),
      context
    );
  }

  escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private buildPosixMarkedCommand(command: string, markerId: string): string {
    const commandToRun = this.quotePosixShellValue(this.normalizeCommandForMarkedExecution(command));
    return [
      `__ait_marker_id='${markerId}'`,
      `printf '\\n__AI_TERMINAL_COMMAND_START_%s__\\n' "$__ait_marker_id"`,
      `eval ${commandToRun}`,
      '__ait_exit_code=$?',
      `printf '\\n__AI_TERMINAL_COMMAND_DONE_%s__:%s\\n' "$__ait_marker_id" "$__ait_exit_code"`,
      'unset __ait_marker_id __ait_exit_code'
    ].join('; ');
  }

  private buildPowerShellMarkedCommand(command: string, markerId: string): string {
    const commandToRun = this.quotePowerShellSingleQuotedValue(
      this.normalizeCommandForMarkedExecution(command)
    );
    return [
      `$__aitMarkerId = '${markerId}'`,
      'Write-Output ("__AI_TERMINAL_COMMAND_START_{0}__" -f $__aitMarkerId)',
      `& ([scriptblock]::Create(${commandToRun}))`,
      '$__aitSuccess = $?',
      '$__aitNativeExitCode = $LASTEXITCODE',
      '$__aitExitCode = if ($null -ne $__aitNativeExitCode) { $__aitNativeExitCode } elseif ($__aitSuccess) { 0 } else { 1 }',
      'Write-Output ("__AI_TERMINAL_COMMAND_DONE_{0}__:{1}" -f $__aitMarkerId, $__aitExitCode)',
      'Remove-Variable __aitMarkerId, __aitSuccess, __aitNativeExitCode, __aitExitCode -ErrorAction SilentlyContinue'
    ].join('; ');
  }

  private normalizeCommandForMarkedExecution(command: string): string {
    return command
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .join('; ');
  }

  private quotePosixShellValue(value: string): string {
    return `'${value.replace(/'/g, `'\\''`)}'`;
  }

  private quotePowerShellSingleQuotedValue(value: string): string {
    return `'${value.replace(/'/g, `''`)}'`;
  }

  private isLikelyInteractiveCommand(command: string): boolean {
    const firstCommand = command
      .replace(/^\s*(?:env\s+)?(?:[A-Za-z_][A-Za-z0-9_]*=\S+\s+)*/, '')
      .replace(/^\s*(?:sudo\s+)+/, '')
      .split(/[;&|]/)[0]
      .trim();

    return (
      /^(?:ssh|sshpass|sftp|scp|mosh)\b/.test(firstCommand) ||
      /^(?:top|htop|less|more|man|vi|vim|nano|emacs|watch)\b/.test(firstCommand) ||
      /^tail\b.*\s-f(?:\s|$)/.test(firstCommand) ||
      /^(?:mysql|psql|redis-cli|mongo|mongosh)\b(?:\s*)$/.test(firstCommand) ||
      /^(?:python|python3|node|irb|rails\s+console|php\s+-a)\b(?:\s*)$/.test(firstCommand)
    );
  }

  private normalizeCapturedTerminalOutput(output: string): string {
    return output
      .replace(/\x1B\][\s\S]*?(?:\x07|\x1B\\)/g, '')
      .replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '')
      .replace(/\x07/g, '')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .replace(/^\n+/, '')
      .replace(/\n+$/, '');
  }

  private hasCapturedCommandEcho(lines: string[], command: string): boolean {
    return lines.slice(0, 40).some((line) => this.isCommandEchoLine(line, command));
  }

  private isCommandEchoLine(line: string, command: string): boolean {
    const normalizedLine = line.trimEnd();
    const normalizedCommand = command.trim();
    return normalizedLine === normalizedCommand || normalizedLine.endsWith(normalizedCommand);
  }

  private isLikelyShellPromptLine(line: string): boolean {
    const trimmedLine = line.trimEnd();
    if (!trimmedLine || trimmedLine.length > 500) {
      return false;
    }

    return (
      /^(?:\([^)]+\)\s*)?[\w.-]+@[\w.-]+(?:[: ][^\n]*)?\s[$#%]\s*$/.test(trimmedLine) ||
      /^(?:\([^)]+\)\s*)?[\w.-]+@[\w.-]+\s+[^\n]*\s[%$#]\s*$/.test(trimmedLine) ||
      /^PS\s+[^\n>]+>\s*$/.test(trimmedLine) ||
      /^[A-Za-z]:\\[^\n>]*>\s*$/.test(trimmedLine) ||
      /^[^\n]{1,120}\s[$#%]\s*$/.test(trimmedLine)
    );
  }

  private findLastMeaningfulLineIndex(lines: string[]): number {
    for (let index = lines.length - 1; index >= 0; index--) {
      if (lines[index].trim().length > 0) {
        return index;
      }
    }

    return -1;
  }

  private hasNonPromptContentBeforeLine(lines: string[], endIndex: number): boolean {
    return lines
      .slice(0, Math.max(0, endIndex))
      .some((line) => {
        const trimmedLine = line.trim();
        return trimmedLine.length > 0 && !this.isLikelyShellPromptLine(trimmedLine);
      });
  }

  private removeCapturedCommandNoise(
    output: string,
    context: CommandExecutionCaptureContext
  ): string {
    const command = context.command.trim();
    const lines = output.split('\n').filter((line) => !this.isGeneratedExecutionNoiseLine(line));

    while (lines.length > 0 && !lines[0].trim()) {
      lines.shift();
    }

    if (command && lines[0]?.trim().endsWith(command)) {
      lines.shift();
    }

    while (lines.length > 0 && !lines[lines.length - 1].trim()) {
      lines.pop();
    }

    return lines.join('\n');
  }

  private isGeneratedExecutionNoiseLine(line: string): boolean {
    return (
      /__ait_marker_id=/.test(line) ||
      /__ait_exit_code=/.test(line) ||
      /unset __ait_marker_id/.test(line) ||
      /__AI_TERMINAL_COMMAND_(?:START|DONE)_/.test(line) ||
      /printf .*__AI_TERMINAL_COMMAND_(?:START|DONE)_/.test(line)
    );
  }
}
