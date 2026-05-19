import { ConnectionProfileService } from './connection-profile.service';

describe('ConnectionProfileService', () => {
  let service: ConnectionProfileService;

  beforeEach(() => {
    service = new ConnectionProfileService();
    localStorage.removeItem(service.storageKey);
  });

  afterEach(() => {
    localStorage.removeItem(service.storageKey);
  });

  it('persists private key passphrase without trimming it', () => {
    const profile = service.createProfile({
      name: 'Key SSH',
      type: 'ssh',
      authMethod: 'privateKey',
      privateKeyPath: ' ~/.ssh/id_ed25519 ',
      privateKeyPassphrase: ' pass phrase '
    });

    expect(profile.privateKeyPath).toBe('~/.ssh/id_ed25519');
    expect(profile.privateKeyPassphrase).toBe(' pass phrase ');

    const reloadedProfile = service.getProfile(profile.id);
    expect(reloadedProfile?.privateKeyPassphrase).toBe(' pass phrase ');
  });
});
