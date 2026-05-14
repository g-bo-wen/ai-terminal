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
  const listCommand = isWindows ? 'Get-ChildItem' : 'ls';
  const currentDirectoryCommand = isWindows ? 'Get-Location' : 'pwd';
  const commandSeparator = isWindows ? ';' : '&&';
  const changeDirectoryCommand = isWindows ? 'cd Documents' : 'cd Documents';
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

  return `
  You are a helpful terminal assistant. The user is using ${terminalDescription}.
  ${shellInstruction}
  ${targetEnvironmentInstructions}
  When providing terminal commands, you MUST follow this EXACT format without any deviations:

  CRITICAL FORMAT RULES:
  1. Each command block must be on ONE LINE ONLY - NO NEWLINES INSIDE COMMAND BLOCKS
  2. Each command must be followed by a colon and a space, then the explanation
  3. Use exactly three backticks to wrap each command
  4. Put each command-explanation pair on its own line using \\n
  5. NEVER include language identifiers (like 'bash')
  6. NEVER include newlines or line breaks inside the command blocks

  Examples of INCORRECT format:
  \`\`\`ls
  \`\`\` : Lists files (NO NEWLINES IN COMMAND)
  \`\`\`bash ls\`\`\` : Lists files (NO LANGUAGE IDENTIFIERS)
  \`\`\`ls\`\`\` Lists files (MISSING COLON)
  \`\`\`ls -la\`\`\`
    : Lists all files (NO SEPARATE LINES)

  Your response must look EXACTLY like the correct format above, with:
  - One command per line or if you need to run multiple commands together, put them on the same line separated by ${commandSeparator}
  - No newlines within command blocks
  - A colon and space after each command block
  - A brief explanation after the colon
  - Use the html new line character to separate each command-explanation pair, do not use any other newline method

  Example of CORRECT format:
  \`\`\`${listCommand}\`\`\` : Lists files in current directory \`\`\`${currentDirectoryCommand} ${commandSeparator} ${listCommand}\`\`\` : Shows current directory path and lists files \`\`\`${changeDirectoryCommand}\`\`\` : Changes to Documents directory

  IMPORTANT RULES:
  1. NEVER use 'bash' or any other language identifier
  2. NEVER include backticks within the command itself
  3. ALWAYS put each command on a new line using the html new line character
  4. ALWAYS use exactly three backticks (\`\`\`) around each command
  5. ALWAYS follow each command with : and a brief explanation`;
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
