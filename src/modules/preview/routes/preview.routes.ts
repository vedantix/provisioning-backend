import { Router } from "express";
import { asyncHandler } from "../../../middleware/async-handler";
import { CustomersRepository } from "../../customers/repositories/customers.repository";
import { PreviewService } from "../services/preview.service";

const router = Router();
const repo = new CustomersRepository();
const previewService = new PreviewService();

function slugify(value: string): string {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function domainSlug(value: string): string {
  const domain = String(value || "")
    .toLowerCase()
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0]
    .split("?")[0]
    .split("#")[0];

  return slugify(domain.split(".").filter(Boolean)[0] || domain);
}

async function resolvePreview(slug: string, tenantId: string) {
  const normalizedSlug = slugify(slug);
  const customers = await repo.listByTenant(tenantId);

  const customer = customers.find((c) => {
    const candidates = [
      c.preview?.slug,
      c.preview?.path?.replace(/^\//, ""),
      domainSlug(c.domain),
      slugify(c.companyName || c.domain),
    ]
      .filter(Boolean)
      .map((value) => String(value).toLowerCase());

    return candidates.includes(normalizedSlug);
  });

  if (!customer) {
    return null;
  }

  const publicSlug = previewService.buildPreviewSlug(
    customer.companyName,
    customer.domain,
  );
  const fullUrl = previewService.buildPreviewUrl(publicSlug);
  const storedTargetUrl = customer.preview?.targetUrl || "";
  const storedFullUrl = customer.preview?.fullUrl || "";
  let targetUrl =
    customer.base44?.previewUrl ||
    (storedTargetUrl &&
    storedTargetUrl !== storedFullUrl &&
    storedTargetUrl !== fullUrl
      ? storedTargetUrl
      : "");

  if (!targetUrl && customer.base44?.editorUrl) {
    targetUrl = customer.base44.editorUrl.replace(
      "/editor",
      "/editor/preview",
    );
  }

  if (!targetUrl) {
    return null;
  }

  return {
    customer,
    preview: {
      slug: publicSlug,
      path: previewService.buildPreviewPath(publicSlug),
      fullUrl,
      targetUrl,
      status: customer.preview?.status || "READY",
      updatedAt: customer.preview?.updatedAt,
    },
  };
}

router.get(
  "/api/preview/:slug",
  asyncHandler(async (req, res) => {
    const tenantId = String(req.ctx?.tenantId || "default");
    const result = await resolvePreview(String(req.params.slug || ""), tenantId);

    if (!result) {
      return res.status(404).json({
        error: "Preview not found",
        requestId: req.ctx?.requestId,
      });
    }

    res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({
      data: {
        preview: result.preview,
        customer: {
          id: result.customer.id,
          companyName: result.customer.companyName,
          domain: result.customer.domain,
        },
      },
      requestId: req.ctx?.requestId,
    });
  }),
);

router.get(
  "/preview/:slug",
  asyncHandler(async (req, res) => {
    const tenantId = String(req.ctx?.tenantId || "default");
    const result = await resolvePreview(String(req.params.slug || ""), tenantId);

    if (!result) {
      return res.status(404).send("Preview not found");
    }

    res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
    res.setHeader("Cache-Control", "no-store");
    return res.redirect(result.preview.targetUrl);
  }),
);

export default router;
