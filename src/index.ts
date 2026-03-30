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
import { createRateLimitMiddleware } from './middleware/rate-limit.middleware';
import { notFoundMiddleware } from './middleware/not-found.middleware';
import { errorHandlerMiddleware } from './middleware/error-handler.middleware';

import { requestContextMiddleware } from './middleware/request-context.middleware';
import { env } from './config/env';
import { requireActorContextMiddleware } from './middleware/require-actor-context.middleware';

const app = express();
app.use(requestContextMiddleware);
app.use(requireActorContextMiddleware);
app.use(createRateLimitMiddleware({ windowMs: 60_000, maxRequests: 60 }));

app.use(express.json());

app.get('/health', (_req, res) => {
  res.status(200).json({ ok: true });
});

app.use(requestContextMiddleware);
app.use('/api', deploymentsDeleteRoutes);
app.use('/api', deploymentsRunRoutes);
app.use('/api', deploymentsRoutes);
app.use('/api', deploymentsAuditRoutes);
app.use('/api', deploymentRoutes);
app.use('/api', domainRoutes);
app.use('/api', packageRoutes);
app.use('/api', mailboxRoutes);
app.use('/api', deleteRoutes);
app.use('/api', redeployRoutes);
app.use('/api', rollbackRoutes);
app.use('/api', deploymentsActionsRoutes);
app.use('/api', deploymentsRoutes);
app.use('/api', deploymentsRunRoutes);
app.use('/api', deploymentsDeleteRoutes);
app.use('/api', deploymentsActionsRoutes);
app.use('/api', deploymentsAuditRoutes);

app.use(notFoundMiddleware);
app.use(errorHandlerMiddleware);

app.use((err: any, req: any, res: any, next: any) => {
  console.error("[UNHANDLED ERROR]", {
    message: err?.message,
    stack: err?.stack,
    name: err?.name,
  });

  res.status(500).json({
    message: err?.message ?? "Internal Server Error",
    stack: process.env.NODE_ENV !== "production" ? err?.stack : undefined,
  });
});

app.listen(env.port, '0.0.0.0', () => {
  console.log(`Provisioning backend running on port ${env.port}`);
});