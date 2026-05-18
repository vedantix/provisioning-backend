import { describe, expect, it } from 'vitest';
import { getMailPackageRule } from '../../../src/modules/mail/package-rules';

describe('getMailPackageRule', () => {
  it('returns correct limits for STARTER', () => {
    const rule = getMailPackageRule('STARTER');

    expect(rule.includedMailboxes).toBe(1);
    expect(rule.defaultMailboxes).toEqual(['info']);
    expect(rule.extraMailboxPricePerMonth).toBe(7);
  });

  it('returns correct limits for GROWTH', () => {
    const rule = getMailPackageRule('GROWTH');

    expect(rule.includedMailboxes).toBe(5);
    expect(rule.defaultMailboxes.length).toBe(5);
  });

  it('returns correct limits for PRO', () => {
    const rule = getMailPackageRule('PRO');

    expect(rule.includedMailboxes).toBe(10);
    expect(rule.defaultMailboxes.length).toBe(10);
  });

  it('supports CUSTOM package', () => {
    const rule = getMailPackageRule('CUSTOM');

    expect(rule.includedMailboxes).toBe(Number.MAX_SAFE_INTEGER);
  });
});
