import { Injectable } from '@angular/core';
import { CommandRiskLevel } from '../models/command-suggestion.model';

@Injectable({
  providedIn: 'root'
})
export class CommandRiskPolicyService {
  requiresConfirmation(risk: CommandRiskLevel): boolean {
    return risk === 'caution' || risk === 'danger';
  }

  getRiskLabel(risk: CommandRiskLevel): string {
    switch (risk) {
      case 'safe':
        return 'Safe';
      case 'danger':
        return 'Danger';
      default:
        return 'Caution';
    }
  }
}
