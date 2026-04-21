import express from "express";
import cors from "cors";

import deploymentRoutes from "./routes/deployment.routes";
import domainRoutes from "./routes/domain.routes";
import packageRoutes from "./routes/package.routes";
import mailboxRoutes from "./routes/mailbox.routes";
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
import adminOpsRoutes from "./routes/admin-ops.routes";

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
import { requireActorContextMiddleware } from "./middleware/require-actor-context.middleware";
import { requireAdminAuthMiddleware } from "./middleware/require-admin-auth.middleware";
import { errorHandlerMiddleware } from "./middleware/error-handler.middleware";
import { requestLoggingMiddleware } from "./middleware/request-logging.middleware";
import { idempotencyMiddleware } from "./middleware/idempotency.middleware";

import { env } from "./config/env";
import { logger } from "./lib/logger";

const app = express();

const allowedOrigins = new Set([
  "https://vedantix.nl",
  "https://www.vedantix.nl",
  "https://api.vedantix.nl",
  "https://preview.vedantix.nl",
  "http://localhost:5173",
]);

app.use(
  cors({
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
  })
);

app.options("*", cors());

app.use(express.json({ limit: env.requestBodyLimit }));

app.get("/health", (_req, res) => {
  res.status(200).json({ ok: true });
});

app.use(systemRoutes);

app.use(requestContextMiddleware);
app.use(requestLoggingMiddleware);
app.use(idempotencyMiddleware);

app.use(
  createRateLimitMiddleware({
    windowMs: env.rateLimitWindowMs,
    maxRequests: env.rateLimitMaxRequests,
  })
);

app.use("/api", pricingRoutes);
app.use("/api/webhooks", base44WebhookRoutes);
app.use("/", previewRoutes);
app.use("/api", adminAuthRoutes);

app.use(requireAdminAuthMiddleware);
app.use(requireActorContextMiddleware);

app.use("/api", customersRoutes);

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

app.use("/api/mail", mailRoutes);
app.use("/api/customers", customerMailRoutes);
app.use("/api/finance", financeRoutes);

app.use(notFoundMiddleware);
app.use(errorHandlerMiddleware);

app.listen(env.port, "0.0.0.0", () => {
  logger.info("Provisioning backend started", {
    port: env.port,
    nodeEnv: env.nodeEnv,
  });
});

export default app;