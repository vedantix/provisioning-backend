import fs from 'fs';
import path from 'path';

export function buildDeployWorkflow(): string {
  const filePath = path.join(__dirname, 'deploy-workflow.yml');
  return fs.readFileSync(filePath, 'utf-8');
}