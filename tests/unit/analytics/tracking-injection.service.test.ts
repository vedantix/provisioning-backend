import { describe, expect, it } from 'vitest';
import { TrackingInjectionService } from '../../../src/services/analytics/tracking-injection.service';

describe('TrackingInjectionService', () => {
  it('injects GA4, Google Ads, Search Console and Clarity tags once', () => {
    const service = new TrackingInjectionService();
    const html = '<!doctype html><html><head><title>Site</title></head><body></body></html>';
    const env = {
      VITE_GA_MEASUREMENT_ID: 'G-ABC123',
      VITE_GOOGLE_SITE_VERIFICATION: 'search-token',
      VITE_GOOGLE_ADS_CONVERSION_ID: '1234567890',
      VITE_GOOGLE_ADS_CONVERSION_LABELS: '{"LEAD":"leadLabel"}',
      VITE_CLARITY_PROJECT_ID: 'clarity123',
    };

    const injected = service.injectIntoHtml(html, env);
    const reinjected = service.injectIntoHtml(injected, env);

    expect(injected).toContain('G-ABC123');
    expect(injected).toContain('google-site-verification');
    expect(injected).toContain('AW-1234567890');
    expect(injected).toContain('clarity.ms/tag');
    expect(reinjected.match(/Vedantix analytics/g)).toHaveLength(2);
  });
});
