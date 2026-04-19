import { Router } from "express";
import { PricingController } from "../controllers/pricing.controller";
import { apiKeyMiddleware } from "../../../middleware/apiKey.middleware";

const router = Router();
const controller = new PricingController();

/**
 * Explicit CORS preflight handlers.
 * These must exist so OPTIONS requests do not fall through to protected middleware.
 */
router.options("/pricing", (_req, res) => {
  res.sendStatus(200);
});

router.options("/pricing/packages/:code", (_req, res) => {
  res.sendStatus(200);
});

router.options("/pricing/addons/:code", (_req, res) => {
  res.sendStatus(200);
});

router.options("/pricing/vat-summary", (_req, res) => {
  res.sendStatus(200);
});

/**
 * Public read routes
 */
router.get("/pricing", controller.getSummary);
router.get("/pricing/vat-summary", controller.getVatSummary);

/**
 * Protected write routes
 */
router.put("/pricing/packages/:code", apiKeyMiddleware, controller.updatePackage);
router.put("/pricing/addons/:code", apiKeyMiddleware, controller.updateAddon);

export default router;