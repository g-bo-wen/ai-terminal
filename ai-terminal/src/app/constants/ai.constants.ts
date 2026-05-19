export interface TerminalAssistantEnvironmentContext {
  terminalKind?: string;
  connectionType?: string;
  profileName?: string;
  targetHost?: string;
  targetUser?: string;
  wslDistroName?: string;
  serverContext?: string;
}

export function buildTerminalAssistantSystemPrompt(
  os: string,
  environmentContext?: TerminalAssistantEnvironmentContext
): string {
  const hasRemoteContext = Boolean(environmentContext?.connectionType);
  const isPosixTarget = hasRemoteContext ||
    environmentContext?.terminalKind === 'local-wsl' ||
    environmentContext?.terminalKind === 'local-zsh';
  const isWindows = !isPosixTarget && os.toLowerCase().includes('windows');
  const targetEnvironmentInstructions = buildTargetEnvironmentInstructions(os, environmentContext);
  const terminalDescription = hasRemoteContext
    ? `a remote SSH-style terminal launched from a ${os} host`
    : environmentContext?.terminalKind === 'local-wsl'
      ? `a WSL Linux terminal launched from a ${os} host`
      : environmentContext?.terminalKind === 'local-zsh'
        ? 'a zsh/POSIX terminal'
        : `a ${os} operating system`;
  const shellInstruction = isWindows
    ? 'Use PowerShell-compatible commands for Windows answers.'
    : isPosixTarget
      ? 'Use POSIX/Linux shell-compatible commands for the active terminal target unless the saved server context says otherwise.'
      : 'Use POSIX shell-compatible commands for macOS and Linux answers.';

  return [
    'You are a helpful terminal assistant.',
    `The user is using ${terminalDescription}.`,
    shellInstruction,
    targetEnvironmentInstructions,
    '',
    'You may answer normally in natural language.',
    '',
    'When you provide a terminal command that should be executable by the UI, you MUST wrap it with this exact tag format:',
    '',
    '<CMD title="short title" risk="safe|caution|danger">command here</CMD>',
    '',
    'Rules:',
    '1. Only executable terminal commands may be placed inside <CMD>.',
    '2. The command inside <CMD> must be exactly one single line.',
    '3. Do not put explanations inside <CMD>.',
    '4. Put explanations outside <CMD>.',
    '5. Do not use Markdown code fences for executable commands.',
    '6. If the answer does not need a command, do not use <CMD>.',
    '7. Read-only inspection commands must use risk="safe".',
    '8. Commands that modify files, services, permissions, packages, containers, processes, firewall rules, or system configuration must use risk="caution".',
    '9. Destructive or irreversible commands must use risk="danger".',
    '10. Do not invent command output.',
    '11. Prefer commands compatible with /bin/sh.',
    '12. Avoid bash-specific syntax unless necessary.',
    '13. Avoid package-manager commands unless the user explicitly asks to install software.',
    '',
    'Example:',
    '',
    '可以从系统版本、内核、CPU、内存和磁盘几个方面查看这台机器的信息。',
    '',
    '<CMD title="查看系统版本" risk="safe">cat /etc/os-release 2>/dev/null || uname -a</CMD>',
    '',
    '<CMD title="查看内核和架构" risk="safe">uname -a</CMD>',
    '',
    '<CMD title="查看 CPU 信息" risk="safe">lscpu 2>/dev/null || cat /proc/cpuinfo</CMD>',
    '',
    '<CMD title="查看内存" risk="safe">free -h</CMD>',
    '',
    '<CMD title="查看磁盘空间" risk="safe">df -h</CMD>',
    '',
    '这些命令都是只读查询，不会修改系统。'
  ].filter(Boolean).join('\n');
}

function buildTargetEnvironmentInstructions(
  localOs: string,
  environmentContext?: TerminalAssistantEnvironmentContext
): string {
  if (!environmentContext?.connectionType && environmentContext?.terminalKind !== 'local-wsl') {
    return '';
  }

  if (environmentContext.terminalKind === 'local-wsl' && !environmentContext.connectionType) {
    return [
      'ACTIVE TERMINAL TARGET:',
      `- The visible terminal is WSL${environmentContext.wslDistroName ? ` (${environmentContext.wslDistroName})` : ''}. Local OS is ${localOs}, but command suggestions should target Linux inside WSL, not PowerShell.`,
      '- Prefer POSIX/Linux shell commands.'
    ].join('\n');
  }

  const target = [
    environmentContext.targetUser && environmentContext.targetHost
      ? `${environmentContext.targetUser}@${environmentContext.targetHost}`
      : environmentContext.targetHost,
    environmentContext.profileName ? `profile=${environmentContext.profileName}` : '',
    environmentContext.connectionType ? `connection=${environmentContext.connectionType}` : ''
  ].filter(Boolean).join(', ');

  return [
    'ACTIVE TERMINAL TARGET:',
    `- The visible terminal is connected through ${environmentContext.connectionType}. Local OS is ${localOs}, but command suggestions should target the remote terminal, not the local host.`,
    '- Prefer POSIX/Linux shell commands unless the server context explicitly says otherwise.',
    target ? `- Target: ${target}.` : '',
    environmentContext.serverContext
      ? `- Saved server context from probe/manual notes:\n${environmentContext.serverContext}`
      : '- No saved probe context is available yet; avoid assuming Windows/PowerShell for this remote session.'
  ].filter(Boolean).join('\n');
}
