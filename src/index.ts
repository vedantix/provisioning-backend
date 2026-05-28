import express from "express";
import cors from "cors";

import deploymentRoutes from "./routes/deployment.routes";
import domainRoutes from "./routes/domain.routes";
import packageRoutes from "./routes/package.routes";
import mailboxRoutes from "./routes/mailbox.routes";
import billingRoutes from "./routes/billing.routes";
import catalogRoutes from "./routes/catalog.routes";
import analyticsRoutes from "./routes/analytics.routes";
import deleteRoutes from "./routes/delete.routes";
import redeployRoutes from "./routes/redeploy.routes";
import rollbackRoutes from "./routes/rollback.routes";
import deploymentsRunRoutes from "./routes/deployments-run.routes";
import deploymentsRoutes from "./routes/deployments.routes";
import deploymentsDeleteRoutes from "./routes/deployments-delete.routes";
import deploymentsActionsRoutes from "./routes/deployments-actions.routes";
import deploymentsRollbackRoutes from "./routes/deployments-rollback.routes";
import deploymentsAuditRoutes from "./routes/deployments-audit.routes";
import operationsRoutes from "./routes/operations.routes";
import systemRoutes from "./routes/system.routes";
import readinessRoutes from "./modules/system/routes/readiness.routes";
import adminOpsRoutes from "./routes/admin-ops.routes";
import base44Webhook from './modules/base44/routes/base44-autocreate.webhook';
import customerBase44Routes from './modules/customers/routes/customer-base44.routes';

import mailRoutes from "./modules/mail/routes/mail.routes";
import customerMailRoutes from "./modules/mail/routes/customer-mail.routes";
import financeRoutes from "./modules/finance/routes/finance.routes";
import pricingRoutes from "./modules/pricing/routes/pricing.routes";
import customersRoutes from "./modules/customers/routes/customers.routes";
import previewRoutes from "./modules/preview/routes/preview.routes";
import base44WebhookRoutes from "./modules/base44/routes/base44-webhook.routes";
import adminAuthRoutes from "./modules/admin-auth/routes/admin-auth.routes";

import { createRateLimitMiddleware } from "./middleware/rate-limit.middleware";
import { notFoundMiddleware } from "./middleware/not-found.middleware";
import { requestContextMiddleware } from "./middleware/request-context.middleware";
import { errorHandlerMiddleware } from "./middleware/error-handler.middleware";
import { requestLoggingMiddleware } from "./middleware/request-logging.middleware";
import { idempotencyMiddleware } from "./middleware/idempotency.middleware";

import { env } from "./config/env";
import { logger } from "./lib/logger";
import { EnvironmentValidationService } from "./services/analytics/environment-validation.service";

const app = express();
new EnvironmentValidationService().validateStartup();

const allowedOrigins = new Set(env.corsAllowedOrigins);

app.disable("x-powered-by");

app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  next();
});

const corsMiddleware = cors({
  origin(origin, callback) {
    if (!origin) {
      callback(null, true);
      return;
    }

    if (allowedOrigins.has(origin)) {
      callback(null, true);
      return;
    }

    callback(new Error(`CORS blocked for origin: ${origin}`));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "X-Api-Key",
    "X-Tenant-Id",
    "X-Actor-Id",
    "X-Source",
    "Idempotency-Key",
    "X-Base44-Webhook-Secret",
    "X-Webhook-Secret",
  ],
});

app.use(corsMiddleware);
app.use(express.json({ limit: env.requestBodyLimit }));

app.get("/health", (_req, res) => {
  res.status(200).json({ ok: true });
});

app.use(readinessRoutes);
app.use(systemRoutes);

app.use(requestContextMiddleware);
app.use(requestLoggingMiddleware);
app.use(idempotencyMiddleware);

app.use(
  createRateLimitMiddleware({
    windowMs: env.rateLimitWindowMs,
    maxRequests: env.rateLimitMaxRequests,
  }),
);

app.use("/api", pricingRoutes);
app.use("/api/webhooks", base44WebhookRoutes);
app.use("/", previewRoutes);
app.use("/api", adminAuthRoutes);
app.use("/api/billing", billingRoutes);
app.use("/api/catalog", catalogRoutes);
app.use("/api/analytics", analyticsRoutes);
app.use("/analytics", analyticsRoutes);

app.use("/api", customersRoutes);
app.use("/api/customers", customerMailRoutes);
app.use("/api/finance", financeRoutes);

app.use("/api", deploymentsRoutes);
app.use("/api", deploymentsRunRoutes);
app.use("/api", deploymentsDeleteRoutes);
app.use("/api", deploymentsActionsRoutes);
app.use("/api", deploymentsRollbackRoutes);
app.use("/api", deploymentsAuditRoutes);
app.use("/api", operationsRoutes);
app.use("/api", adminOpsRoutes);

app.use("/api", deploymentRoutes);
app.use("/api", domainRoutes);
app.use("/api", packageRoutes);
app.use("/api", mailboxRoutes);
app.use("/api", deleteRoutes);
app.use("/api", redeployRoutes);
app.use("/api", rollbackRoutes);
app.use('/api', customerBase44Routes);

app.use("/api/mail", mailRoutes);

app.use('/internal', base44Webhook);

app.use(notFoundMiddleware);
app.use(errorHandlerMiddleware);

app.listen(env.port, "0.0.0.0", () => {
  logger.info("Provisioning backend started", {
    port: env.port,
    nodeEnv: env.nodeEnv,
  });
});

export default app;
