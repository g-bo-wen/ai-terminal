import { CommandHistory } from './command-history.model';
import { TerminalProfileKind } from './terminal-profile.model';

export interface TerminalLaunchCommand {
  executable: string;
  args: string[];
}

export type TerminalConnectionState = 'ready' | 'connecting' | 'connected' | 'failed' | 'disconnected' | 'ended';

export interface TerminalSession {
  id: string;
  name: string;
  commandHistory: CommandHistory[];
  currentWorkingDirectory: string;
  isActive: boolean;
  gitBranch: string;
  isSshSessionActive: boolean;
  currentSshUserHost: string | null;
  connectionProfileId?: string;
  terminalKind?: TerminalProfileKind;
  wslDistroName?: string;
  launchCommand?: TerminalLaunchCommand;
  connectionState?: TerminalConnectionState;
  connectionEndReason?: string;
  connectionEndedAt?: string;
}
