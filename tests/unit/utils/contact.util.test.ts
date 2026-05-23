import { describe, expect, it } from 'vitest';
import { normalizePostalCodeForCountry } from '../../../src/utils/contact.util';

describe('contact.util', () => {
  it('formats Dutch postal codes with the required space', () => {
    expect(normalizePostalCodeForCountry('NL', '5235HB')).toBe('5235 HB');
    expect(normalizePostalCodeForCountry('nl', '5235 hb')).toBe('5235 HB');
  });

  it('keeps non-Dutch postal codes trimmed without country-specific formatting', () => {
    expect(normalizePostalCodeForCountry('BE', ' 1000 ')).toBe('1000');
  });
});
