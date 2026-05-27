function jsString(value: string): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

function normalizeGoogleSiteVerification(value?: string): string {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return raw.replace(/^google-site-verification=/i, '').replace(/^"|"$/g, '').trim();
}

function parseLabels(value?: string): Record<string, string> {
  if (!value) return {};

  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed).filter(([, item]) => typeof item === 'string' && item.trim()),
    ) as Record<string, string>;
  } catch {
    return {};
  }
}

export class TrackingInjectionService {
  buildHeadTags(environment: Record<string, string>): string[] {
    const ga = environment.VITE_GA_MEASUREMENT_ID || environment.NEXT_PUBLIC_GA_MEASUREMENT_ID;
    const clarity = environment.VITE_CLARITY_PROJECT_ID || environment.NEXT_PUBLIC_CLARITY_PROJECT_ID;
    const googleAdsConversionId =
      environment.VITE_GOOGLE_ADS_CONVERSION_ID ||
      environment.NEXT_PUBLIC_GOOGLE_ADS_CONVERSION_ID;
    const googleAdsLabels = parseLabels(
      environment.VITE_GOOGLE_ADS_CONVERSION_LABELS ||
        environment.NEXT_PUBLIC_GOOGLE_ADS_CONVERSION_LABELS,
    );
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

    if (googleAdsConversionId) {
      const conversionId = googleAdsConversionId.startsWith('AW-')
        ? googleAdsConversionId.slice(3)
        : googleAdsConversionId;
      tags.push(`<script async src="https://www.googletagmanager.com/gtag/js?id=AW-${this.escapeAttribute(conversionId)}"></script>`);
      tags.push(`<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','AW-${this.escapeScript(conversionId)}');window.vedantixTrackConversion=function(eventName,extra){var labels=${JSON.stringify(googleAdsLabels)};var label=labels[eventName];if(!label||typeof gtag!=='function')return;gtag('event','conversion',Object.assign({send_to:'AW-${this.escapeScript(conversionId)}/'+label},extra||{}));};document.addEventListener('submit',function(event){if(event.target&&event.target.matches('form'))window.vedantixTrackConversion('CONTACT_FORM');},true);document.addEventListener('click',function(event){var link=event.target&&event.target.closest?event.target.closest('a'):null;if(!link)return;var href=(link.getAttribute('href')||'').toLowerCase();if(href.includes('wa.me')||href.includes('whatsapp'))window.vedantixTrackConversion('WHATSAPP_CLICK');if(link.dataset&&link.dataset.vedantixConversion)window.vedantixTrackConversion(link.dataset.vedantixConversion);},true);</script>`);
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

  private escapeAttribute(value: string): string {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  private escapeScript(value: string): string {
    return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/</g, '\\u003c');
  }
}
