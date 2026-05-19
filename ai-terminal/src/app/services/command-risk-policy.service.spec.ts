import { CommandRiskPolicyService } from './command-risk-policy.service';

describe('CommandRiskPolicyService', () => {
  let service: CommandRiskPolicyService;

  beforeEach(() => {
    service = new CommandRiskPolicyService();
  });

  it('does not require confirmation for safe commands', () => {
    expect(service.requiresConfirmation('safe')).toBeFalse();
  });

  it('requires confirmation for danger commands', () => {
    expect(service.requiresConfirmation('danger')).toBeTrue();
  });

  it('requires confirmation for caution commands', () => {
    expect(service.requiresConfirmation('caution')).toBeTrue();
  });
});
