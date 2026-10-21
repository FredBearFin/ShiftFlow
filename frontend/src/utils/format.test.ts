import { describe, expect, it } from 'vitest';
import { formatCurrency, formatHourlyRate } from './format';

describe('formatCurrency', () => {
  it('groups thousands and always shows two decimals', () => {
    expect(formatCurrency(10754)).toBe('$10,754.00');
    expect(formatCurrency(10754.4)).toBe('$10,754.40');
    expect(formatCurrency(0)).toBe('$0.00');
  });

  it('renders the same amount identically however it arrives', () => {
    expect(formatCurrency(10001.22)).toBe(formatCurrency(10001.219999));
  });

  it('rounds to cents rather than truncating', () => {
    expect(formatCurrency(1.005)).toBe('$1.01');
  });

  it('returns an empty string for a missing or non-finite amount', () => {
    expect(formatCurrency(null)).toBe('');
    expect(formatCurrency(undefined)).toBe('');
    expect(formatCurrency(Number.NaN)).toBe('');
    expect(formatCurrency(Number.POSITIVE_INFINITY)).toBe('');
  });

  it('keeps negatives signed', () => {
    expect(formatCurrency(-250)).toBe('-$250.00');
  });
});

describe('formatHourlyRate', () => {
  it('suffixes a formatted amount with /hr', () => {
    expect(formatHourlyRate(18.5)).toBe('$18.50/hr');
  });

  it('returns an empty string when the wage is missing', () => {
    expect(formatHourlyRate(null)).toBe('');
  });
});
