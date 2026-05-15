import { Injectable } from '@angular/core';
import { AutoInputRule, ConnectionProfile, ConnectionProfileType } from '../models/connection-profile.model';

@Injectable({
  providedIn: 'root'
})
export class ConnectionProbeLogicService {
  buildServerProbeScriptLines(startMarker: string, endMarker: string): string[] {
    const startNonce = startMarker.replace('__AI_TERMINAL_PROBE_START_', '').replace('__', '');
    const endNonce = endMarker.replace('__AI_TERMINAL_PROBE_END_', '').replace('__', '');
    return [
      `set +e 2>/dev/null; set +o pipefail 2>/dev/null || true`,
      `printf '%s%s%s\\n' '__AI_TERMINAL_' 'PROBE_START_' '${startNonce}__'`,
      this.buildSafeProbeFieldCommand('hostname', `hostname 2>/dev/null || uname -n 2>/dev/null || true`),
      this.buildSafeProbeFieldCommand('kernel', `uname -srmo 2>/dev/null || uname -a 2>/dev/null || true`),
      this.buildSafeProbeFieldCommand('os', `sh -c '. /etc/os-release 2>/dev/null && printf "%s %s" "$PRETTY_NAME" "$VERSION_ID"' 2>/dev/null || head -n 1 /etc/issue 2>/dev/null || true`),
      this.buildSafeProbeFieldCommand('arch', `uname -m 2>/dev/null || true`),
      this.buildSafeProbeFieldCommand('shell', `printf '%s' "$SHELL"`),
      this.buildSafeProbeFieldCommand('user', `id -un 2>/dev/null || whoami 2>/dev/null || true`),
      this.buildSafeProbeFieldCommand('pwd', `pwd 2>/dev/null || true`),
      this.buildSafeProbeFieldCommand('id', `id 2>/dev/null || true`),
      this.buildSafeProbeFieldCommand('cpu', `lscpu 2>/dev/null | sed -n 's/^Model name:[[:space:]]*//p;s/^Architecture:[[:space:]]*/Architecture: /p' | head -n 3 || true`),
      this.buildSafeProbeFieldCommand('memory', `free -h 2>/dev/null | sed -n '1,2p' || true`),
      this.buildSafeProbeFieldCommand('package_managers', `for c in apt yum dnf zypper apk pacman brew; do command -v "$c" >/dev/null 2>&1 && printf '%s ' "$c"; done`),
      `printf '%s%s%s\\n' '__AI_TERMINAL_' 'PROBE_END_' '${endNonce}__'`
    ];
  }

  extractStructuredProbeOutput(output: string): string {
    const fields = [
      'hostname',
      'kernel',
      'os',
      'arch',
      'shell',
      'user',
      'pwd',
      'id',
      'cpu',
      'memory',
      'package_managers'
    ];
    const normalized = output.replace(/\r/g, '');

    const result: string[] = [];
    for (const field of fields) {
      const beginMarker = `__AI_TERMINAL_FIELD_BEGIN__${field}`;
      const endMarker = `__AI_TERMINAL_FIELD_END__${field}`;
      const beginIndex = normalized.indexOf(beginMarker);
      const endIndex = normalized.indexOf(endMarker, beginIndex + beginMarker.length);
      const match = beginIndex >= 0 && endIndex > beginIndex
        ? normalized.slice(beginIndex + beginMarker.length, endIndex)
        : '';
      if (!match) {
        result.push(`${field}=`);
        continue;
      }

      const value = this.cleanProbeFieldValue(match);
      result.push(`${field}=${value}`);
    }

    return result.join('\n').trim();
  }

  buildServerContextFromProbe(
    profile: ConnectionProfile,
    rawProbeOutput: string,
    probedAt: string
  ): string {
    const target = this.getSshUserHost(profile) || profile.targetHost || profile.jumpHost || profile.name;
    const jump = profile.type === 'jumpserver' && profile.jumpHost
      ? ` via ${profile.jumpUser ? `${profile.jumpUser}@` : ''}${profile.jumpHost}`
      : '';
    return [
      `Profile: ${profile.name}`,
      `Connection type: ${this.getConnectionTypeLabel(profile.type)}`,
      `Target: ${target}${jump}`,
      `Probe updated at: ${probedAt}`,
      'Shell guidance: use POSIX/Linux shell commands for this profile unless the details below clearly indicate otherwise.',
      '',
      'Probe result:',
      rawProbeOutput
    ].join('\n');
  }

  hasProbeConnectionFailure(output: string): boolean {
    return /(?:Permission denied[^\n\r]*(?:publickey|password|please try again)|Connection refused|Connection closed|Connection reset|Broken pipe|Could not resolve hostname|Name or service not known|No route to host|Connection timed out|Operation timed out|Host key verification failed|REMOTE HOST IDENTIFICATION HAS CHANGED|Too many authentication failures|kex_exchange_identification|no matching host key type|no matching key exchange method)/i.test(output);
  }

  hasProbeTransportFailure(output: string): boolean {
    return /(?:Connection closed|Connection reset|Broken pipe|Connection timed out|Operation timed out|kex_exchange_identification)/i.test(output);
  }

  formatProbeFailureMessage(error: unknown, cleanOutput: string): string {
    const maybeMessage = (error as { message?: unknown } | null | undefined)?.message;
    const rawMessage = typeof maybeMessage === 'string' ? maybeMessage : String(error || 'Unknown error');
    const cleanMessage = this.normalizeTerminalOutput(rawMessage);
    const combined = `${cleanMessage}\n${cleanOutput}`;
    const failureLine = this.extractProbeFailureLine(combined);
    const summary = failureLine || cleanMessage.split(/\r?\n/).find((line) => line.trim()) || 'Unknown error';
    return this.truncateStatusMessage(summary, 220);
  }

  hasPasswordPrompt(output: string): boolean {
    const normalizedOutput = this.normalizeTerminalOutput(output);
    return /(?:password|passphrase|密码)[^:\n\r]*[:：][\s\u0000-\u001f]*$/i.test(normalizedOutput);
  }

  hasLikelyShellPrompt(output: string): boolean {
    const lines = this.normalizeTerminalOutput(output)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    const lastLine = lines[lines.length - 1] || '';
    return /(?:^|[A-Za-z0-9_.-]+@[^:\s]+:.*)[#$]\s*$|PS\s+[^>]+>\s*$/.test(lastLine);
  }

  doesAutoInputRuleMatch(rule: AutoInputRule, output: string): boolean {
    const pattern = rule.whenOutputMatches.trim();
    if (!pattern) {
      return false;
    }

    const normalizedOutput = this.normalizeTerminalOutput(output);
    try {
      return new RegExp(pattern).test(normalizedOutput);
    } catch {
      return normalizedOutput.includes(pattern);
    }
  }

  normalizeTerminalOutput(output: string): string {
    return output
      .replace(/\x1B\][^\x07]*(?:\x07|\x1B\\)/g, '')
      .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '')
      .replace(/\x1B[()][A-Za-z0-9]/g, '')
      .replace(/\x1B./g, '')
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
  }

  withProbeDebugOutput(debugLogs: string[], output: string): string {
    return [...debugLogs, output].filter((section) => section.trim().length > 0).join('\n');
  }

  private buildSafeProbeFieldCommand(label: string, command: string): string {
    return `printf '__AI_TERMINAL_FIELD_BEGIN__${label}\\n'; { ${command}; } 2>/dev/null || true; printf '\\n__AI_TERMINAL_FIELD_END__${label}\\n'`;
  }

  private cleanProbeFieldValue(value: string): string {
    return value
      .split(/\n/)
      .map((line) => line.trim())
      .filter((line) =>
        line.length > 0 &&
        !line.includes("printf '") &&
        !line.includes('PROBE_END_') &&
        !/^[^@\s]+@[^:\s]+:.*[#$]\s*/.test(line) &&
        !/^PS\s+[^>]+>/.test(line)
      )
      .join('\n')
      .trim();
  }

  private extractProbeFailureLine(output: string): string {
    const lines = output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    return lines.find((line) =>
      /(?:Permission denied|Connection refused|Connection closed|Connection reset|Broken pipe|Could not resolve hostname|Name or service not known|No route to host|Connection timed out|Operation timed out|Host key verification failed|REMOTE HOST IDENTIFICATION HAS CHANGED|Too many authentication failures|kex_exchange_identification|no matching host key type|no matching key exchange method)/i.test(line)
    ) || '';
  }

  private truncateStatusMessage(message: string, maxLength: number): string {
    const singleLine = message.replace(/\s+/g, ' ').trim();
    return singleLine.length > maxLength ? `${singleLine.slice(0, maxLength - 1)}...` : singleLine;
  }

  private getConnectionTypeLabel(type: ConnectionProfileType): string {
    return type === 'jumpserver' ? 'JumpServer' : 'SSH';
  }

  private getSshUserHost(profile: ConnectionProfile): string {
    const host = profile.targetHost?.trim() || '';
    const user = profile.targetUser?.trim();
    return user ? `${user}@${host}` : host;
  }
}
