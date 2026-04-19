import express from "express";

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

import { createRateLimitMiddleware } from "./middleware/rate-limit.middleware";
import { notFoundMiddleware } from "./middleware/not-found.middleware";
import { requestContextMiddleware } from "./middleware/request-context.middleware";
import { requireActorContextMiddleware } from "./middleware/require-actor-context.middleware";
import { errorHandlerMiddleware } from "./middleware/error-handler.middleware";
import { requestLoggingMiddleware } from "./middleware/request-logging.middleware";
import { idempotencyMiddleware } from "./middleware/idempotency.middleware";

import { env } from "./config/env";
import { logger } from "./lib/logger";

const app = express();

/**
 * 🔥 DEBUG MARKER (check App Runner logs)
 */
console.log("BOOT_MARKER_OPTIONS_V4");

/**
 * 🔥 CORS + PREFLIGHT (ALTIJD ALS EERSTE)
 */
const allowedOrigins = new Set([
  "https://vedantix.nl",
  "https://www.vedantix.nl",
  "https://api.vedantix.nl",
  "http://localhost:5173",
]);

app.use((req, res, next) => {
  const origin = String(req.headers.origin || "");

  if (allowedOrigins.has(origin)) {
    res.header("Access-Control-Allow-Origin", origin);
  }

  res.header("Vary", "Origin");
  res.header("Access-Control-Allow-Credentials", "true");
  res.header("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  res.header(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Api-Key, X-Tenant-Id, X-Actor-Id, X-Source, Idempotency-Key"
  );

  if (req.method === "OPTIONS") {
    console.log("OPTIONS_HIT", req.originalUrl);
    return res.sendStatus(200);
  }

  next();
});

/**
 * BODY PARSER
 */
app.use(express.json({ limit: env.requestBodyLimit }));

/**
 * HEALTH CHECK
 */
app.get("/health", (_req, res) => {
  res.status(200).json({ ok: true });
});

/**
 * SYSTEM ROUTES (indien nodig vroeg)
 */
app.use(systemRoutes);

/**
 * SHARED MIDDLEWARE
 */
app.use(requestContextMiddleware);
app.use(requestLoggingMiddleware);
app.use(idempotencyMiddleware);

app.use(
  createRateLimitMiddleware({
    windowMs: env.rateLimitWindowMs,
    maxRequests: env.rateLimitMaxRequests,
  })
);

/**
 * 🔓 PUBLIC ROUTES (BELANGRIJK)
 */
app.use("/api", pricingRoutes);

/**
 * 🔐 PROTECTED ROUTES
 */
app.use(requireActorContextMiddleware);

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

/**
 * ERROR HANDLING
 */
app.use(notFoundMiddleware);
app.use(errorHandlerMiddleware);

/**
 * START SERVER
 */
app.listen(env.port, "0.0.0.0", () => {
  logger.info("Provisioning backend started", {
    port: env.port,
    nodeEnv: env.nodeEnv,
  });
});

export default app;