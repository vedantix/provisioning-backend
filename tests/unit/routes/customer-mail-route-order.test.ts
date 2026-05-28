import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('customer mail route order', () => {
  it('mounts customer mail before broad legacy api-key routers', () => {
    const indexSource = readFileSync(join(process.cwd(), 'src/index.ts'), 'utf8');

    const customerMailMount = indexSource.indexOf(
      'app.use("/api/customers", customerMailRoutes);',
    );
    const broadDeploymentMount = indexSource.indexOf(
      'app.use("/api", deploymentsRoutes);',
    );
    const legacyDeploymentMount = indexSource.indexOf(
      'app.use("/api", deploymentRoutes);',
    );

    expect(customerMailMount).toBeGreaterThan(-1);
    expect(broadDeploymentMount).toBeGreaterThan(-1);
    expect(legacyDeploymentMount).toBeGreaterThan(-1);
    expect(customerMailMount).toBeLessThan(broadDeploymentMount);
    expect(customerMailMount).toBeLessThan(legacyDeploymentMount);
  });
});
