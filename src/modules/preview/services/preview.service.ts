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

function parseUrl(value: string): URL | null {
  const raw = String(value || "").trim();
  if (!raw) return null;

  try {
    return new URL(raw);
  } catch {
    if (/^[a-z0-9.-]+\.[a-z]{2,}(\/.*)?$/i.test(raw)) {
      try {
        return new URL(`https://${raw}`);
      } catch {
        return null;
      }
    }
  }

  return null;
}

function normalizeUrl(url: URL): string {
  url.hash = "";
  return url.toString();
}

function isBase44PublicHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized.endsWith(".base44.app");
}

function isBase44EditorHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === "app.base44.com";
}

function isVedantixPreviewHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === "preview.vedantix.nl";
}

function isUnsafePreviewTarget(url: URL): boolean {
  return (
    isBase44EditorHost(url.hostname) ||
    isVedantixPreviewHost(url.hostname) ||
    url.pathname.toLowerCase().includes("/editor")
  );
}

function normalizeBase44PublicUrl(value?: string): string {
  const url = parseUrl(String(value || ""));
  if (!url || !isBase44PublicHost(url.hostname)) {
    return "";
  }

  return url.origin;
}

function buildBase44PublicUrlFromName(value?: string): string {
  const raw = String(value || "").trim();
  if (!raw) return "";

  const publicUrl = normalizeBase44PublicUrl(raw);
  if (publicUrl) return publicUrl;

  if (parseUrl(raw)) return "";

  const withoutHost = raw.replace(/\.base44\.app$/i, "");
  if (!/^[a-z0-9-]+$/i.test(withoutHost)) {
    return "";
  }

  const slug = slugify(withoutHost);

  if (!slug || /^app-/.test(slug)) {
    return "";
  }

  return `https://${slug}.base44.app`;
}

function buildBase44PublicUrlFromEditorUrl(value?: string): string {
  const url = parseUrl(String(value || ""));
  if (!url) return "";

  if (isBase44PublicHost(url.hostname)) {
    return url.origin;
  }

  const parts = url.pathname.split("/").filter(Boolean);
  const appsIndex = parts.findIndex((part) => part.toLowerCase() === "apps");
  const candidate = appsIndex >= 0 ? parts[appsIndex + 1] : "";
  const slug = slugify(candidate || "");

  if (!slug || /^app-/.test(slug) || /^[a-f0-9-]{16,}$/i.test(slug)) {
    return "";
  }

  return `https://${slug}.base44.app`;
}

function normalizeSafePreviewTarget(value?: string): string {
  const url = parseUrl(String(value || ""));
  if (!url || isUnsafePreviewTarget(url)) {
    return "";
  }

  return normalizeUrl(url);
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
    base44EditorUrl?: string;
    base44AppName?: string;
    fallbackTargetUrl?: string;
  }) {
    const slug = this.buildPreviewSlug(params.companyName, params.domain);
    const path = this.buildPreviewPath(slug);
    const fullUrl = this.buildPreviewUrl(slug);
    const targetUrl = this.resolvePreviewTargetUrl({
      base44PreviewUrl: params.base44PreviewUrl,
      base44EditorUrl: params.base44EditorUrl,
      base44AppName: params.base44AppName,
      fallbackTargetUrl: params.fallbackTargetUrl,
    });

    return {
      slug,
      path,
      fullUrl,
      targetUrl: targetUrl || fullUrl,
      isIndexed: false,
      isPasswordProtected: false,
      status: targetUrl ? "READY" : "NOT_READY",
      updatedAt: new Date().toISOString(),
    } as const;
  }

  resolveBase44PublicUrl(params: {
    base44PreviewUrl?: string;
    base44EditorUrl?: string;
    base44AppName?: string;
  }): string {
    return (
      normalizeBase44PublicUrl(params.base44PreviewUrl) ||
      buildBase44PublicUrlFromName(params.base44AppName) ||
      buildBase44PublicUrlFromEditorUrl(params.base44EditorUrl)
    );
  }

  resolvePreviewTargetUrl(params: {
    base44PreviewUrl?: string;
    base44EditorUrl?: string;
    base44AppName?: string;
    fallbackTargetUrl?: string;
  }): string {
    return (
      this.resolveBase44PublicUrl(params) ||
      normalizeSafePreviewTarget(params.base44PreviewUrl) ||
      normalizeSafePreviewTarget(params.fallbackTargetUrl)
    );
  }
}
