import { env } from "../../../config/env";

function slugify(value: string): string {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeDomain(value: string): string {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0]
    .split("?")[0]
    .split("#")[0]
    .replace(/:+$/, "");
}

function buildSlugFromDomain(domain: string): string {
  const normalized = normalizeDomain(domain);
  const rootLabel = normalized.split(".").filter(Boolean)[0] || normalized;
  return slugify(rootLabel);
}

function joinUrl(baseUrl: string, path: string): string {
  const base = String(baseUrl || "").replace(/\/+$/, "");
  const suffix = String(path || "").replace(/^\/+/, "");
  return `${base}/${suffix}`;
}

export class PreviewService {
  buildPreviewSlug(companyName: string, domain: string): string {
    const domainSlug = buildSlugFromDomain(domain);
    const companySlug = slugify(companyName);
    return domainSlug || companySlug;
  }

  buildPreviewPath(slug: string): string {
    return `/${slug}`;
  }

  buildPreviewUrl(slug: string): string {
    return joinUrl(env.publicPreviewBaseUrl, slug);
  }

  buildPreviewMetadata(params: {
    companyName: string;
    domain: string;
    base44PreviewUrl?: string;
  }) {
    const slug = this.buildPreviewSlug(params.companyName, params.domain);
    const path = this.buildPreviewPath(slug);
    const fullUrl = this.buildPreviewUrl(slug);

    return {
      slug,
      path,
      fullUrl,
      targetUrl: params.base44PreviewUrl || fullUrl,
      isIndexed: false,
      isPasswordProtected: false,
      status: params.base44PreviewUrl ? "READY" : "NOT_READY",
      updatedAt: new Date().toISOString(),
    } as const;
  }
}
