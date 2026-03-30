import express from 'express';
import deploymentRoutes from './routes/deployment.routes';
import domainRoutes from './routes/domain.routes';
import packageRoutes from './routes/package.routes';
import mailboxRoutes from './routes/mailbox.routes';
import deleteRoutes from './routes/delete.routes';
import redeployRoutes from './routes/redeploy.routes';
import rollbackRoutes from './routes/rollback.routes';
import deploymentsRunRoutes from './routes/deployments-run.routes';
import deploymentsRoutes from './routes/deployments.routes';
import deploymentsDeleteRoutes from './routes/deployments-delete.routes';
import deploymentsActionsRoutes from './routes/deployments-actions.routes';
import deploymentsAuditRoutes from './routes/deployments-audit.routes';
import operationsRoutes from './routes/operations.routes';
import systemRoutes from './routes/system.routes';
import adminOpsRoutes from './routes/admin-ops.routes';

import { createRateLimitMiddleware } from './middleware/rate-limit.middleware';
import { notFoundMiddleware } from './middleware/not-found.middleware';
import { requestContextMiddleware } from './middleware/request-context.middleware';
import { requireActorContextMiddleware } from './middleware/require-actor-context.middleware';
import { errorHandlerMiddleware } from './middleware/error-handler.middleware';

import { env } from './config/env';

const app = express();

app.use(express.json());

app.use(systemRoutes);

app.use(requestContextMiddleware);
app.use(requireActorContextMiddleware);
app.use(createRateLimitMiddleware({ windowMs: 60_000, maxRequests: 60 }));

app.use('/api', deploymentsRoutes);
app.use('/api', deploymentsRunRoutes);
app.use('/api', deploymentsDeleteRoutes);
app.use('/api', deploymentsActionsRoutes);
app.use('/api', deploymentsAuditRoutes);
app.use('/api', operationsRoutes);
app.use('/api', adminOpsRoutes);

app.use('/api', deploymentRoutes);
app.use('/api', domainRoutes);
app.use('/api', packageRoutes);
app.use('/api', mailboxRoutes);
app.use('/api', deleteRoutes);
app.use('/api', redeployRoutes);
app.use('/api', rollbackRoutes);

app.use(notFoundMiddleware);
app.use(errorHandlerMiddleware);

app.listen(env.port, '0.0.0.0', () => {
  console.log(`Provisioning backend running on port ${env.port}`);
});

export default app;