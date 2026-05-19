import { ConnectionProbeLogicService } from './connection-probe-logic.service';

describe('ConnectionProbeLogicService', () => {
  let service: ConnectionProbeLogicService;

  beforeEach(() => {
    service = new ConnectionProbeLogicService();
  });

  it('detects a private key passphrase prompt that contains a Windows key path', () => {
    expect(service.hasPasswordPrompt("Enter passphrase for key 'D:\\Download\\nas':")).toBeTrue();
  });

  it('continues to detect normal password prompts', () => {
    expect(service.hasPasswordPrompt("root@example.com's password:")).toBeTrue();
  });
});
