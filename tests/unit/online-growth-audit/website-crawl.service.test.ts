import { describe, expect, it } from 'vitest';
import {
  parsePage,
  WebsiteCrawlService,
} from '../../../src/modules/online-growth-audit/services/website-crawl.service';

describe('WebsiteCrawlService URL-beveiliging', () => {
  it.each([
    'http://127.0.0.1',
    'http://10.0.0.1',
    'http://169.254.169.254/latest/meta-data',
    'http://localhost:3000',
  ])('blokkeert interne URL %s', async (url) => {
    await expect(new WebsiteCrawlService().crawl(url)).rejects.toThrow(/publiek|Privé|interne/i);
  });

  it('haalt bewijs uit gerenderde HTML zonder losse reviewwoorden als review te tellen', () => {
    const result = parsePage({
      requestedUrl: 'https://example.nl/',
      finalUrl: 'https://example.nl/',
      statusCode: 200,
      responseTimeMs: 220,
      headers: { 'content-type': 'text/html; charset=utf-8' },
      renderMode: 'BROWSER_RENDERED',
      html: `<!doctype html><html><head>
        <title>Voorbeeldbedrijf voor websites</title>
        <meta name="description" content="Een duidelijke omschrijving voor de voorbeeldwebsite.">
        <link rel="canonical" href="https://example.nl/">
        <script>window.dataLayer=[];function gtag(){dataLayer.push(arguments)};gtag('config','G-ABC12345')</script>
        <script type="application/ld+json">{"@type":"Organization","name":"Voorbeeldbedrijf"}</script>
      </head><body><main>
        <h1>Websites voor ondernemers</h1><h2>Wat kost een website?</h2>
        <p>Het woord reviews staat in deze gewone tekst, maar er is geen testimonialsectie.</p>
        <details><summary>Hoe werkt het?</summary><p>Met een heldere aanpak.</p></details>
        <form><input name="email"><button>Vraag advies aan</button></form>
        <a href="mailto:info@example.nl">Mail ons</a><a href="tel:+31612345678">Bel ons</a>
      </main></body></html>`,
    });

    expect(result.renderMode).toBe('BROWSER_RENDERED');
    expect(result.schemaTypes).toContain('Organization');
    expect(result.analyticsProviders).toContain('Google Analytics 4');
    expect(result.faqCount).toBe(2);
    expect(result.hasContactForm).toBe(true);
    expect(result.hasPhone).toBe(true);
    expect(result.hasEmail).toBe(true);
    expect(result.hasReviews).toBe(false);
  });
});
