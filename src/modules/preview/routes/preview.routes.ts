import { Router } from "express";
import axios from "axios";
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

async function discoverPublicBase44Url(...values: Array<string | undefined>) {
  const candidates = values
    .map((value) => String(value || "").trim())
    .filter((value) => value && isEditorLikePreviewUrl(value));

  for (const candidate of candidates) {
    try {
      const response = await axios.get<string>(candidate, {
        responseType: "text",
        timeout: 5000,
        validateStatus: (status) => status >= 200 && status < 500,
      });
      const matches =
        String(response.data || "").match(/https?:\/\/[a-z0-9-]+\.base44\.app/gi) || [];

      for (const match of matches) {
        const publicUrl = normalizeDiscoveredBase44Url(match);
        if (publicUrl) {
          return publicUrl;
        }
      }
    } catch (error) {
      console.warn("[PREVIEW_BASE44_DISCOVERY_FAILED]", {
        candidate,
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  return "";
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
  const targetUrl =
    (await discoverPublicBase44Url(
      customer.base44?.previewUrl,
      customer.base44?.editorUrl,
      fallbackTargetUrl,
    )) ||
    previewService.resolvePreviewTargetUrl({
      base44PreviewUrl: customer.base44?.previewUrl,
      base44EditorUrl: customer.base44?.editorUrl,
      base44AppName: customer.base44?.appName,
      fallbackTargetUrl,
    });

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
  "/api/preview/:slug/html",
  asyncHandler(async (req, res) => {
    const tenantId = String(req.ctx?.tenantId || "default");
    const result = await resolvePreview(String(req.params.slug || ""), tenantId);

    if (!result) {
      return res.status(404).send("Preview not found");
    }

    const response = await axios.get<string>(result.preview.targetUrl, {
      responseType: "text",
      timeout: 15000,
      validateStatus: (status) => status >= 200 && status < 400,
    });
    const html = rewritePreviewHtml(
      response.data,
      result.preview.targetUrl,
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

    res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
    res.setHeader("Cache-Control", "no-store");
    return res.redirect(result.preview.targetUrl);
  }),
);

export default router;
