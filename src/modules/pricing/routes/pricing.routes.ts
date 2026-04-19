import { Router } from "express";
import { PricingController } from "../controllers/pricing.controller";
import { apiKeyMiddleware } from "../../../middleware/apiKey.middleware";

const router = Router();
const controller = new PricingController();

/**
 * 🔓 PUBLIC READ
 */
router.get("/pricing", controller.getSummary);
router.get("/pricing/vat-summary", controller.getVatSummary);

/**
 * 🔐 WRITE (ADMIN)
 */
router.put("/pricing/packages/:code", apiKeyMiddleware, controller.updatePackage);
router.put("/pricing/addons/:code", apiKeyMiddleware, controller.updateAddon);

export default router;