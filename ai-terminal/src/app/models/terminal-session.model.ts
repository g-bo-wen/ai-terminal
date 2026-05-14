import { CommandHistory } from './command-history.model';
import { TerminalProfileKind } from './terminal-profile.model';

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
}
