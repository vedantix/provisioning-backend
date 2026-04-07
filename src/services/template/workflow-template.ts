import { buildDeployWorkflow } from '../../templates/github/deploy-workflow';

export function generateDeployWorkflow(): string {
  return buildDeployWorkflow();
}