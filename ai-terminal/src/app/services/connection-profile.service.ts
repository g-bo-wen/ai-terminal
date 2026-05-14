import { Injectable } from '@angular/core';
import {
  AutoInputRule,
  ConnectionAuthMethod,
  ConnectionProfile,
  ConnectionProfileType,
  CreateConnectionProfileInput,
  UpdateConnectionProfilePatch
} from '../models/connection-profile.model';

@Injectable({
  providedIn: 'root'
})
export class ConnectionProfileService {
  readonly storageKey = 'ai-terminal.connection-profiles';

  listProfiles(): ConnectionProfile[] {
    return this.readProfiles();
  }

  getProfile(id: string): ConnectionProfile | undefined {
    return this.readProfiles().find((profile) => profile.id === id);
  }

  createProfile(input: CreateConnectionProfileInput): ConnectionProfile {
    const profiles = this.readProfiles();
    const profile = this.createDefaultProfile(input);
    this.writeProfiles([...profiles, profile]);
    return profile;
  }

  updateProfile(id: string, patch: UpdateConnectionProfilePatch): ConnectionProfile | undefined {
    const profiles = this.readProfiles();
    const existingProfile = profiles.find((profile) => profile.id === id);
    if (!existingProfile) {
      return undefined;
    }

    const updatedProfile = this.normalizeProfile({
      ...existingProfile,
      ...patch,
      id: existingProfile.id,
      createdAt: existingProfile.createdAt,
      updatedAt: this.now()
    });
    if (!updatedProfile) {
      return undefined;
    }

    const nextProfiles = profiles.map((profile) => (
      profile.id === id ? updatedProfile : profile
    ));
    this.writeProfiles(nextProfiles);
    return updatedProfile;
  }

  deleteProfile(id: string): boolean {
    const profiles = this.readProfiles();
    const nextProfiles = profiles.filter((profile) => profile.id !== id);
    if (nextProfiles.length === profiles.length) {
      return false;
    }

    this.writeProfiles(nextProfiles);
    return true;
  }

  duplicateProfile(id: string): ConnectionProfile | undefined {
    const profiles = this.readProfiles();
    const sourceProfile = profiles.find((profile) => profile.id === id);
    if (!sourceProfile) {
      return undefined;
    }

    const timestamp = this.now();
    const duplicatedProfile = this.normalizeProfile({
      ...sourceProfile,
      id: this.generateId(),
      name: `${sourceProfile.name} Copy`,
      lastConnectedAt: undefined,
      createdAt: timestamp,
      updatedAt: timestamp
    });
    if (!duplicatedProfile) {
      return undefined;
    }

    this.writeProfiles([...profiles, duplicatedProfile]);
    return duplicatedProfile;
  }

  markConnected(id: string): ConnectionProfile | undefined {
    const timestamp = this.now();
    return this.updateProfile(id, {
      lastConnectedAt: timestamp
    });
  }

  createDefaultProfile(
    overrides: Partial<CreateConnectionProfileInput> = {}
  ): ConnectionProfile {
    const timestamp = this.now();
    const profile = this.normalizeProfile({
      id: this.generateId(),
      name: overrides.name || 'New Connection',
      type: overrides.type || 'ssh',
      authMethod: overrides.authMethod || 'password',
      autoInputRules: [],
      tags: [],
      createdAt: timestamp,
      updatedAt: timestamp,
      ...overrides
    });
    if (!profile) {
      throw new Error('Could not create connection profile defaults.');
    }

    return profile;
  }

  generateConnectionDisplayName(profile: ConnectionProfile): string {
    const name = profile.name.trim();
    const targetHost = profile.targetHost?.trim();
    const jumpHost = profile.jumpHost?.trim();

    if (profile.type === 'jumpserver') {
      if (name && targetHost) {
        return name.includes(targetHost) ? name : `${name} -> ${targetHost}`;
      }

      if (jumpHost && targetHost) {
        return `${jumpHost} -> ${targetHost}`;
      }

      return name || targetHost || jumpHost || 'JumpServer connection';
    }

    if (name && targetHost) {
      return this.appendHostWhenMissing(name, targetHost);
    }

    if (profile.targetUser?.trim() && targetHost) {
      return `${profile.targetUser.trim()}@${targetHost}`;
    }

    return name || targetHost || 'SSH connection';
  }

  private readProfiles(): ConnectionProfile[] {
    const storage = this.getStorage();
    if (!storage) {
      return [];
    }

    const storedProfiles = storage.getItem(this.storageKey);
    if (!storedProfiles) {
      return [];
    }

    try {
      const parsed = JSON.parse(storedProfiles);
      if (!Array.isArray(parsed)) {
        storage.removeItem(this.storageKey);
        return [];
      }

      const profiles = parsed
        .map((value: unknown) => this.normalizeProfile(value))
        .filter((profile): profile is ConnectionProfile => profile !== null);

      if (JSON.stringify(parsed) !== JSON.stringify(profiles)) {
        this.writeProfiles(profiles);
      }

      return profiles;
    } catch (error) {
      console.error('Failed to load connection profiles:', error);
      storage.removeItem(this.storageKey);
      return [];
    }
  }

  private writeProfiles(profiles: ConnectionProfile[]): void {
    const storage = this.getStorage();
    if (!storage) {
      return;
    }

    storage.setItem(this.storageKey, JSON.stringify(profiles));
  }

  private normalizeProfile(value: unknown): ConnectionProfile | null {
    if (!this.isRecord(value)) {
      return null;
    }

    const timestamp = this.now();
    const type = this.normalizeType(value['type']);
    const authMethod = this.normalizeAuthMethod(value['authMethod']);

    return {
      id: this.normalizeString(value['id']) || this.generateId(),
      name: this.normalizeString(value['name']) || 'Untitled Connection',
      type,
      jumpHost: this.normalizeOptionalString(value['jumpHost']),
      jumpPort: this.normalizeOptionalPort(value['jumpPort']),
      jumpUser: this.normalizeOptionalString(value['jumpUser']),
      jumpPassword: this.normalizeOptionalRawString(value['jumpPassword']),
      targetHost: this.normalizeOptionalString(value['targetHost']),
      targetPort: this.normalizeOptionalPort(value['targetPort']),
      targetUser: this.normalizeOptionalString(value['targetUser']),
      targetPassword: this.normalizeOptionalRawString(value['targetPassword']),
      authMethod,
      privateKeyPath: this.normalizeOptionalString(value['privateKeyPath']),
      autoInputRules: this.normalizeAutoInputRules(value['autoInputRules']),
      tags: this.normalizeTags(value['tags']),
      description: this.normalizeOptionalString(value['description']),
      serverContext: this.normalizeOptionalRawString(value['serverContext']),
      serverContextPath: this.normalizeOptionalString(value['serverContextPath']),
      probeRawOutput: this.normalizeOptionalRawString(value['probeRawOutput']),
      probeUpdatedAt: this.normalizeOptionalString(value['probeUpdatedAt']),
      lastConnectedAt: this.normalizeOptionalString(value['lastConnectedAt']),
      createdAt: this.normalizeOptionalString(value['createdAt']) || timestamp,
      updatedAt: this.normalizeOptionalString(value['updatedAt']) || timestamp
    };
  }

  private normalizeAutoInputRules(value: unknown): AutoInputRule[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .map((rule) => this.normalizeAutoInputRule(rule))
      .filter((rule): rule is AutoInputRule => rule !== null);
  }

  private normalizeAutoInputRule(value: unknown): AutoInputRule | null {
    if (!this.isRecord(value)) {
      return null;
    }

    return {
      id: this.normalizeString(value['id']) || this.generateId(),
      whenOutputMatches: this.normalizeString(value['whenOutputMatches']),
      input: this.normalizeString(value['input']),
      appendEnter: typeof value['appendEnter'] === 'boolean' ? value['appendEnter'] : true,
      enabled: typeof value['enabled'] === 'boolean' ? value['enabled'] : true
    };
  }

  private normalizeTags(value: unknown): string[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .map((tag) => this.normalizeString(tag))
      .filter((tag) => tag.length > 0);
  }

  private normalizeType(value: unknown): ConnectionProfileType {
    return value === 'jumpserver' ? 'jumpserver' : 'ssh';
  }

  private normalizeAuthMethod(value: unknown): ConnectionAuthMethod {
    if (
      value === 'privateKey' ||
      value === 'sshAgent' ||
      value === 'manual' ||
      value === 'password'
    ) {
      return value;
    }

    return 'password';
  }

  private normalizeOptionalPort(value: unknown): number | undefined {
    if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
      return undefined;
    }

    return value;
  }

  private normalizeOptionalString(value: unknown): string | undefined {
    const normalized = this.normalizeString(value);
    return normalized || undefined;
  }

  private normalizeOptionalRawString(value: unknown): string | undefined {
    return typeof value === 'string' ? value : undefined;
  }

  private normalizeString(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
  }

  private appendHostWhenMissing(name: string, host: string): string {
    return name.includes(host) ? name : `${name} ${host}`;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private getStorage(): Storage | null {
    return typeof globalThis.localStorage === 'undefined' ? null : globalThis.localStorage;
  }

  private generateId(): string {
    if (globalThis.crypto?.randomUUID) {
      return globalThis.crypto.randomUUID();
    }

    return `connection-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  }

  private now(): string {
    return new Date().toISOString();
  }
}
