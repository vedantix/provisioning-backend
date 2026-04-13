import { Router } from "express";
import { PricingController } from "../controllers/pricing.controller";

const router = Router();
const controller = new PricingController();

router.get("/pricing", controller.getSummary);
router.put("/pricing/packages/:code", controller.updatePackage);
router.put("/pricing/addons/:code", controller.updateAddon);
router.get("/pricing/vat-summary", controller.getVatSummary);

export default router;