import express from 'express';
import deploymentRoutes from './routes/deployment.routes';
import domainRoutes from './routes/domain.routes';
import packageRoutes from './routes/package.routes';
import mailboxRoutes from './routes/mailbox.routes';
import deleteRoutes from './routes/delete.routes';
import redeployRoutes from './routes/redeploy.routes';
import rollbackRoutes from './routes/rollback.routes';
import { env } from './config/env';

const app = express();

app.use(express.json());

app.get('/health', (_req, res) => {
  res.status(200).json({ ok: true });
});

app.use('/api', deploymentRoutes);
app.use('/api', domainRoutes);
app.use('/api', packageRoutes);
app.use('/api', mailboxRoutes);
app.use('/api', deleteRoutes);
app.use('/api', redeployRoutes);
app.use('/api', rollbackRoutes);

app.listen(env.port, '0.0.0.0', () => {
  console.log(`Provisioning backend running on port ${env.port}`);
});