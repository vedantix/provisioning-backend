import { Router } from "express";
import { PricingController } from "../controllers/pricing.controller";
import { requireAdminAuthMiddleware } from "../../../middleware/require-admin-auth.middleware";

const router = Router();
const controller = new PricingController();

/**
 * Public read
 */
router.get("/pricing", controller.getSummary);
router.get("/pricing/vat-summary", controller.getVatSummary);

/**
 * Admin write
 */
router.put(
  "/pricing/packages/:code",
  requireAdminAuthMiddleware,
  controller.updatePackage
);

router.put(
  "/pricing/addons/:code",
  requireAdminAuthMiddleware,
  controller.updateAddon
);

export default router;