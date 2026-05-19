export type ConnectionProfileType = 'ssh' | 'jumpserver';

export type ConnectionAuthMethod = 'password' | 'privateKey' | 'sshAgent' | 'manual';

export interface AutoInputRule {
  id: string;
  whenOutputMatches: string;
  input: string;
  appendEnter: boolean;
  enabled: boolean;
}

export interface ConnectionProfile {
  id: string;
  name: string;
  type: ConnectionProfileType;
  jumpHost?: string;
  jumpPort?: number;
  jumpUser?: string;
  jumpPassword?: string;
  targetHost?: string;
  targetPort?: number;
  targetUser?: string;
  targetPassword?: string;
  authMethod: ConnectionAuthMethod;
  privateKeyPath?: string;
  privateKeyPassphrase?: string;
  autoInputRules: AutoInputRule[];
  tags: string[];
  description?: string;
  serverContext?: string;
  serverContextPath?: string;
  probeRawOutput?: string;
  probeUpdatedAt?: string;
  lastConnectedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export type CreateConnectionProfileInput = Partial<
  Omit<ConnectionProfile, 'id' | 'createdAt' | 'updatedAt'>
> & {
  name: string;
  type: ConnectionProfileType;
};

export type UpdateConnectionProfilePatch = Partial<
  Omit<ConnectionProfile, 'id' | 'createdAt' | 'updatedAt'>
>;
