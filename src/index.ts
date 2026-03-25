import express from 'express';
import deploymentRoutes from './routes/deployment.routes';
import { env } from './config/env';

const app = express();

app.use(express.json());

app.get('/health', (_req, res) => {
  res.status(200).json({ ok: true });
});

app.use('/api', deploymentRoutes);

app.listen(env.port, '0.0.0.0', () => {
  console.log(`Provisioning backend running on port ${env.port}`);
});