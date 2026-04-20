import { Router } from "express";
import { asyncHandler } from "../../../middleware/async-handler";
import { CustomersRepository } from "../../customers/repositories/customers.repository";

const router = Router();
const repo = new CustomersRepository();

function slugify(value: string): string {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

router.get(
  "/preview/:slug",
  asyncHandler(async (req, res) => {
    const slug = String(req.params.slug || "").toLowerCase();
    const tenantId = String(req.ctx?.tenantId || "default");

    const customers = await repo.listByTenant(tenantId);

    const match = customers.find((c) => {
      const s = c.preview?.slug || slugify(c.companyName || c.domain);
      return s === slug;
    });

    if (!match || !match.base44?.previewUrl) {
      return res.status(404).send("Preview not found");
    }

    res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
    res.setHeader("Cache-Control", "no-store");
    return res.redirect(match.base44.previewUrl);
  }),
);

export default router;