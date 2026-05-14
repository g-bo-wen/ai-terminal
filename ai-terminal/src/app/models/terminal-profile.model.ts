import { ConnectionProfile } from './connection-profile.model';

export type TerminalProfileSource = 'builtin' | 'wsl' | 'connection';

export type TerminalProfileKind =
  | 'local-powershell'
  | 'local-powershell-admin'
  | 'local-zsh'
  | 'local-wsl'
  | 'ssh'
  | 'jumpserver';

export interface WslDistribution {
  name: string;
  state: string;
  version?: number;
  isDefault: boolean;
}

export interface TerminalProfileViewItem {
  id: string;
  source: TerminalProfileSource;
  kind: TerminalProfileKind;
  name: string;
  displayName: string;
  status?: string;
  group: 'local' | 'wsl' | 'connection';
  editable: boolean;
  deletable: boolean;
  probeable: boolean;
  disabled?: boolean;
  disabledReason?: string;
  connectionProfile?: ConnectionProfile;
  connectionProfileId?: string;
  wslDistroName?: string;
}
