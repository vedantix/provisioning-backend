function slugify(value: string): string {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export class PreviewService {
  buildPreviewSlug(companyName: string, domain: string): string {
    const companySlug = slugify(companyName);
    const domainSlug = slugify(String(domain || "").split(".")[0] || domain);
    return companySlug || domainSlug;
  }

  buildPreviewPath(slug: string): string {
    return `/${slug}`;
  }

  buildPreviewUrl(slug: string): string {
    return `https://preview.vedantix.nl/${slug}`;
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