import { Injectable } from '@angular/core';
import { ConnectionProfile } from '../models/connection-profile.model';

@Injectable({
  providedIn: 'root'
})
export class ConnectionCommandService {
  buildSshCommand(profile: ConnectionProfile, operatingSystem: string): string {
    if (profile.type === 'jumpserver') {
      return this.buildJumpServerSshCommand(profile, operatingSystem);
    }

    return this.buildTargetSshCommand(profile, operatingSystem);
  }

  buildDirectProbeSshCommand(profile: ConnectionProfile, operatingSystem: string): string {
    const host = profile.targetHost?.trim();
    if (!host) {
      throw new Error('Target host is required for SSH probe.');
    }

    const commandParts = [...this.createBaseSshCommandParts(), '-T'];
    if (profile.authMethod === 'privateKey' && profile.privateKeyPath?.trim()) {
      commandParts.push('-i', this.quoteShellArg(profile.privateKeyPath.trim(), operatingSystem));
    }

    if (profile.targetPort) {
      commandParts.push('-p', String(profile.targetPort));
    }

    const user = profile.targetUser?.trim();
    commandParts.push(user ? `${user}@${host}` : host, 'sh', '-s');
    return commandParts.join(' ');
  }

  getSshUserHost(profile: ConnectionProfile): string {
    const host = profile.targetHost?.trim() || '';
    const user = profile.targetUser?.trim();
    return user ? `${user}@${host}` : host;
  }

  private buildTargetSshCommand(profile: ConnectionProfile, operatingSystem: string): string {
    const host = profile.targetHost?.trim();
    if (!host) {
      throw new Error('Target host is required for SSH connections.');
    }

    const commandParts = this.createBaseSshCommandParts();
    if (profile.authMethod === 'privateKey' && profile.privateKeyPath?.trim()) {
      commandParts.push('-i', this.quoteShellArg(profile.privateKeyPath.trim(), operatingSystem));
    }

    if (profile.targetPort) {
      commandParts.push('-p', String(profile.targetPort));
    }

    const user = profile.targetUser?.trim();
    commandParts.push(user ? `${user}@${host}` : host);
    return commandParts.join(' ');
  }

  private buildJumpServerSshCommand(profile: ConnectionProfile, operatingSystem: string): string {
    const host = profile.jumpHost?.trim();
    if (!host) {
      throw new Error('JumpServer host is required for JumpServer connections.');
    }

    const commandParts = this.createBaseSshCommandParts();
    if (profile.authMethod === 'privateKey' && profile.privateKeyPath?.trim()) {
      commandParts.push('-i', this.quoteShellArg(profile.privateKeyPath.trim(), operatingSystem));
    }

    if (profile.jumpPort) {
      commandParts.push('-p', String(profile.jumpPort));
    }

    const user = profile.jumpUser?.trim();
    commandParts.push(user ? `${user}@${host}` : host);
    return commandParts.join(' ');
  }

  private createBaseSshCommandParts(): string[] {
    return ['ssh', '-o', 'StrictHostKeyChecking=accept-new'];
  }

  private quoteShellArg(value: string, operatingSystem: string): string {
    if (/^[A-Za-z0-9_@%+=:,./\\~-]+$/.test(value)) {
      return value;
    }

    if (operatingSystem === 'Windows') {
      return `'${value.replace(/'/g, "''")}'`;
    }

    return `'${value.replace(/'/g, "'\\''")}'`;
  }
}
