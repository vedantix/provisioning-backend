import { Router } from "express";
import axios from "axios";
import { asyncHandler } from "../../../middleware/async-handler";
import { CustomersRepository } from "../../customers/repositories/customers.repository";
import type { CustomerRecord } from "../../customers/types/customer.types";
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

function unique(values: string[]): string[] {
  return Array.from(
    new Set(values.map((value) => String(value || "").trim()).filter(Boolean)),
  );
}

function parseMaybeUrl(value: string): URL | null {
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

function isEditorLikePreviewUrl(value?: string): boolean {
  const url = parseMaybeUrl(String(value || ""));
  if (!url) return false;

  const hostname = url.hostname.toLowerCase();
  return (
    hostname === "app.base44.com" ||
    hostname === "preview.vedantix.nl" ||
    url.pathname.toLowerCase().includes("/editor")
  );
}

function normalizeDiscoveredBase44Url(value: string): string {
  const url = parseMaybeUrl(value);
  if (!url || !url.hostname.toLowerCase().endsWith(".base44.app")) {
    return "";
  }

  return url.origin;
}

function normalizePreviewCandidateUrl(value?: string): string {
  const url = parseMaybeUrl(String(value || ""));
  if (!url) return "";

  const hostname = url.hostname.toLowerCase();
  if (
    hostname === "app.base44.com" ||
    hostname === "preview.vedantix.nl" ||
    url.pathname.toLowerCase().includes("/editor")
  ) {
    return "";
  }

  url.hash = "";
  return url.hostname.toLowerCase().endsWith(".base44.app")
    ? url.origin
    : url.toString();
}

function buildBase44UrlFromSlug(value: string): string {
  const slug = slugify(value);
  if (!slug || /^app-/.test(slug) || /^[a-f0-9-]{16,}$/i.test(slug)) {
    return "";
  }

  return `https://${slug}.base44.app`;
}

function compactSlug(value: string): string {
  return slugify(value).replace(/-/g, "");
}

function withGerundVariants(slug: string): string[] {
  const parts = slug.split("-").filter(Boolean);
  const variants = new Set([slug]);

  parts.forEach((part, index) => {
    if (!part.endsWith("ing") || part.length <= 4) return;

    const next = [...parts];
    next[index] = `${part.slice(0, -3)}s`;
    variants.add(next.join("-"));
  });

  return Array.from(variants);
}

function extractLocationSlugs(customer: CustomerRecord): string[] {
  const values = [
    customer.city,
    customer.address,
    customer.notes,
    customer.requestedPrompt,
    customer.base44?.requestedPrompt,
  ]
    .map((value) => String(value || ""))
    .filter(Boolean);
  const locations: string[] = [];

  if (customer.city) {
    locations.push(slugify(customer.city), compactSlug(customer.city));
  }

  const text = values.join("\n");
  const companySlug = slugify(customer.companyName);
  const locationPattern =
    /\b(?:in|te|voor)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})/g;
  let match: RegExpExecArray | null;

  while ((match = locationPattern.exec(text))) {
    const location = match[1];
    const slug = slugify(location);
    if (
      !slug ||
      slug === companySlug ||
      ["nederland", "growth", "starter", "pro"].includes(slug)
    ) {
      continue;
    }

    locations.push(slug, compactSlug(location));
  }

  return unique(locations);
}

function buildBase44PublicUrlCandidates(customer: CustomerRecord): string[] {
  const directCandidates = [
    customer.base44?.previewUrl,
    customer.preview?.targetUrl,
  ].map((value) => normalizeDiscoveredBase44Url(String(value || "")));
  const rawAppName = String(customer.base44?.appName || "").trim();
  const appNameSlug =
    rawAppName && /^[a-z0-9-]+$/i.test(rawAppName)
      ? slugify(rawAppName)
      : "";
  const baseSlugs = unique([
    appNameSlug,
    domainSlug(customer.domain),
    slugify(customer.companyName),
  ]).flatMap(withGerundVariants);
  const locationSlugs = extractLocationSlugs(customer);
  const combinedSlugs = baseSlugs.flatMap((baseSlug) => [
    baseSlug,
    ...locationSlugs.flatMap((locationSlug) => [
      `${baseSlug}-${locationSlug}`,
      `${baseSlug}-${locationSlug.replace(/-/g, "")}`,
    ]),
  ]);

  return unique([...directCandidates, ...combinedSlugs.map(buildBase44UrlFromSlug)])
    .filter(Boolean)
    .slice(0, 24);
}

function extractDiscoveredBase44Urls(html: string): string[] {
  const matches =
    String(html || "").match(/https?:\/\/[a-z0-9-]+\.base44\.app/gi) || [];

  return unique(matches.map(normalizeDiscoveredBase44Url)).filter(Boolean);
}

async function discoverPublicBase44Urls(...values: Array<string | undefined>) {
  const candidates = values
    .map((value) => String(value || "").trim())
    .filter((value) => value && isEditorLikePreviewUrl(value));
  const discovered: string[] = [];

  for (const candidate of candidates) {
    try {
      const response = await axios.get<string>(candidate, {
        responseType: "text",
        timeout: 5000,
        validateStatus: (status) => status >= 200 && status < 500,
      });
      discovered.push(...extractDiscoveredBase44Urls(response.data));
    } catch (error) {
      console.warn("[PREVIEW_BASE44_DISCOVERY_FAILED]", {
        candidate,
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  return unique(discovered);
}

function jsonForScript(value: string): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function absolutizeRootAssetUrls(html: string, targetOrigin: string): string {
  return html
    .replace(
      /(<(?:script|link|img|source|video|audio)\b[^>]*\s(?:src|href|poster)=["'])\/(?!\/)/gi,
      `$1${targetOrigin}/`,
    )
    .replace(
      /(<(?:source|img)\b[^>]*\ssrcset=["'])(\/(?!\/)[^"']*)(["'])/gi,
      (_match, prefix: string, value: string, suffix: string) => {
        const rewritten = value.replace(
          /(^|,\s*)\/(?!\/)([^,\s]+)/g,
          (_item, separator: string, path: string) =>
            `${separator}${targetOrigin}/${path}`,
        );
        return `${prefix}${rewritten}${suffix}`;
      },
    );
}

function rewritePreviewHtml(html: string, targetUrl: string, previewPath: string): string {
  const target = new URL(targetUrl);
  const targetOrigin = target.origin;
  const publicPath = previewPath.startsWith("/") ? previewPath : `/${previewPath}`;
  const runtime = `
<script>
(() => {
  const targetOrigin = ${jsonForScript(targetOrigin)};
  const publicPath = ${jsonForScript(publicPath)};
  const apiPathPattern = /^\\/(api|apps|prod|functions|app-logs|agent-conversations|ws-user-apps|socket\\.io|engine\\.io)(\\/|$)/;

  const rewriteUrl = (value) => {
    try {
      const parsed = new URL(String(value), window.location.origin);
      if (parsed.origin === window.location.origin && apiPathPattern.test(parsed.pathname)) {
        return targetOrigin + parsed.pathname + parsed.search + parsed.hash;
      }
    } catch {}
    return value;
  };

  if (window.location.pathname !== "/") {
    window.history.replaceState(window.history.state, "", "/" + window.location.search + window.location.hash);
  }

  const nativeFetch = window.fetch ? window.fetch.bind(window) : null;
  if (nativeFetch) {
    window.fetch = (input, init) => {
      if (typeof input === "string" || input instanceof URL) {
        return nativeFetch(rewriteUrl(input.toString()), init);
      }

      if (input instanceof Request) {
        const nextUrl = rewriteUrl(input.url);
        if (nextUrl !== input.url) {
          return nativeFetch(new Request(nextUrl, input), init);
        }
      }

      return nativeFetch(input, init);
    };
  }

  const nativeOpen = window.XMLHttpRequest && window.XMLHttpRequest.prototype.open;
  if (nativeOpen) {
    window.XMLHttpRequest.prototype.open = function(method, url, ...rest) {
      return nativeOpen.call(this, method, rewriteUrl(url), ...rest);
    };
  }

  const restorePublicPath = () => {
    if (window.location.pathname !== publicPath) {
      window.history.replaceState(window.history.state, "", publicPath + window.location.search + window.location.hash);
    }
  };

  window.addEventListener("load", () => window.setTimeout(restorePublicPath, 0));
  window.setTimeout(restorePublicPath, 1200);
  window.setTimeout(restorePublicPath, 3000);
})();
</script>`;
  const robotsMeta = '<meta name="robots" content="noindex,nofollow,noarchive">';
  const rewritten = absolutizeRootAssetUrls(html, targetOrigin)
    .replace(/<meta[^>]+name=["']robots["'][^>]*>/i, "")
    .replace(/<link[^>]+rel=["']canonical["'][^>]*>/i, "");

  if (/<head[^>]*>/i.test(rewritten)) {
    return rewritten.replace(/<head([^>]*)>/i, `<head$1>\n${robotsMeta}\n${runtime}`);
  }

  return `${runtime}${rewritten}`;
}

function isLikelyHtml(value: string): boolean {
  const snippet = String(value || "").slice(0, 4000).toLowerCase();
  return (
    snippet.includes("<!doctype html") ||
    snippet.includes("<html") ||
    snippet.includes("<head") ||
    snippet.includes("<body") ||
    snippet.includes('id="root"')
  );
}

async function fetchPreviewHtmlCandidate(targetUrl: string) {
  const normalizedTargetUrl = normalizePreviewCandidateUrl(targetUrl);
  if (!normalizedTargetUrl) return null;

  try {
    const response = await axios.get<string>(normalizedTargetUrl, {
      responseType: "text",
      timeout: 10000,
      validateStatus: (status) => status >= 200 && status < 500,
    });
    const body = String(response.data || "");

    if (
      response.status >= 200 &&
      response.status < 400 &&
      isLikelyHtml(body)
    ) {
      return { targetUrl: normalizedTargetUrl, html: body };
    }

    console.warn("[PREVIEW_TARGET_UNAVAILABLE]", {
      targetUrl: normalizedTargetUrl,
      status: response.status,
      contentType: response.headers["content-type"],
    });
  } catch (error) {
    console.warn("[PREVIEW_TARGET_FETCH_FAILED]", {
      targetUrl: normalizedTargetUrl,
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }

  return null;
}

async function fetchFirstAvailablePreviewHtml(targetUrls: string[]) {
  for (const targetUrl of targetUrls) {
    const result = await fetchPreviewHtmlCandidate(targetUrl);
    if (result) {
      return result;
    }
  }

  return null;
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
  const fallbackTargetUrl =
    storedTargetUrl &&
    storedTargetUrl !== storedFullUrl &&
    storedTargetUrl !== fullUrl
      ? storedTargetUrl
      : "";
  const discoveredTargetUrls = await discoverPublicBase44Urls(
    customer.base44?.previewUrl,
    customer.base44?.editorUrl,
    fallbackTargetUrl,
  );
  const resolvedTargetUrl = previewService.resolvePreviewTargetUrl({
    base44PreviewUrl: customer.base44?.previewUrl,
    base44EditorUrl: customer.base44?.editorUrl,
    base44AppName: customer.base44?.appName,
    fallbackTargetUrl,
  });
  const targetCandidates = unique(
    [
      ...discoveredTargetUrls,
      resolvedTargetUrl,
      customer.base44?.previewUrl,
      fallbackTargetUrl,
      ...buildBase44PublicUrlCandidates(customer),
    ].map((value) => normalizePreviewCandidateUrl(value)),
  );
  const targetUrl = targetCandidates[0] || "";

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
    targetCandidates,
  };
}

router.get(
  "/api/preview/:slug/html",
  asyncHandler(async (req, res) => {
    const tenantId = String(req.ctx?.tenantId || "default");
    const result = await resolvePreview(String(req.params.slug || ""), tenantId);

    if (!result) {
      return res.status(404).send("Preview not found");
    }

    const response = await fetchFirstAvailablePreviewHtml(result.targetCandidates);
    if (!response) {
      return res
        .status(404)
        .send(
          "Preview target not reachable. Controleer de publieke Base44 URL in het admin panel.",
        );
    }

    const html = rewritePreviewHtml(
      response.html,
      response.targetUrl,
      result.preview.path,
    );

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).send(html);
  }),
);

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

    const response = await fetchFirstAvailablePreviewHtml(result.targetCandidates);
    if (!response) {
      return res
        .status(404)
        .send(
          "Preview target not reachable. Controleer de publieke Base44 URL in het admin panel.",
        );
    }

    res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
    res.setHeader("Cache-Control", "no-store");
    return res.redirect(response.targetUrl);
  }),
);

export default router;
