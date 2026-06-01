function jsString(value: string): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

function normalizeGoogleSiteVerification(value?: string): string {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return raw.replace(/^google-site-verification=/i, '').replace(/^"|"$/g, '').trim();
}

export class TrackingInjectionService {
  buildHeadTags(environment: Record<string, string>): string[] {
    const ga = environment.VITE_GA_MEASUREMENT_ID || environment.NEXT_PUBLIC_GA_MEASUREMENT_ID;
    const clarity = environment.VITE_CLARITY_PROJECT_ID || environment.NEXT_PUBLIC_CLARITY_PROJECT_ID;
    const googleSiteVerification = normalizeGoogleSiteVerification(
      environment.VITE_GOOGLE_SITE_VERIFICATION ||
        environment.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION,
    );
    const tags: string[] = [];

    if (googleSiteVerification) {
      tags.push(
        `<meta name="google-site-verification" content="${this.escapeAttribute(googleSiteVerification)}">`,
      );
    }

    if (ga) {
      tags.push(`<script async src="https://www.googletagmanager.com/gtag/js?id=${this.escapeAttribute(ga)}"></script>`);
      tags.push(`<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config',${jsString(ga)});</script>`);
    }

    if (clarity) {
      tags.push(`<script>(function(c,l,a,r,i,t,y){c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);})(window,document,"clarity","script",${jsString(clarity)});</script>`);
    }

    return tags;
  }

  injectIntoHtml(html: string, environment: Record<string, string>): string {
    const tags = this.buildHeadTags(environment);
    if (!tags.length) return html;

    const withoutExistingBlock = html.replace(
      /\n?<!-- Vedantix analytics -->[\s\S]*?<!-- \/Vedantix analytics -->\n?/i,
      '',
    );
    const block = `\n<!-- Vedantix analytics -->\n${tags.join('\n')}\n<!-- /Vedantix analytics -->\n`;

    if (/<head[^>]*>/i.test(withoutExistingBlock)) {
      return withoutExistingBlock.replace(/<head([^>]*)>/i, `<head$1>${block}`);
    }

    return `${block}${withoutExistingBlock}`;
  }

  validateHtml(html: string, environment: Record<string, string>): {
    ok: boolean;
    missing: string[];
  } {
    const missing: string[] = [];
    const ga = environment.VITE_GA_MEASUREMENT_ID || environment.NEXT_PUBLIC_GA_MEASUREMENT_ID;
    const googleSiteVerification = normalizeGoogleSiteVerification(
      environment.VITE_GOOGLE_SITE_VERIFICATION ||
        environment.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION,
    );
    const clarity = environment.VITE_CLARITY_PROJECT_ID || environment.NEXT_PUBLIC_CLARITY_PROJECT_ID;

    if (ga && !html.includes(ga)) {
      missing.push('GOOGLE_ANALYTICS');
    }

    if (googleSiteVerification && !html.includes(googleSiteVerification)) {
      missing.push('SEARCH_CONSOLE_VERIFICATION');
    }

    if (clarity && !html.includes(clarity)) {
      missing.push('CLARITY');
    }

    return {
      ok: missing.length === 0,
      missing,
    };
  }

  private escapeAttribute(value: string): string {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

}
