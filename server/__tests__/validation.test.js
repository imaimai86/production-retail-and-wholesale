const {
  isNonEmptyString,
  isPositiveInt,
  isValidStatus,
  isPresent
} = require('../validation');

describe('validation helpers', () => {
  test('isNonEmptyString', () => {
    expect(isNonEmptyString('retail')).toBe(true);
    expect(isNonEmptyString(' a ')).toBe(true);
    expect(isNonEmptyString('')).toBe(false);
    expect(isNonEmptyString('   ')).toBe(false);
    expect(isNonEmptyString(undefined)).toBe(false);
    expect(isNonEmptyString(null)).toBe(false);
    expect(isNonEmptyString(5)).toBe(false);
    expect(isNonEmptyString({})).toBe(false);
  });

  test('isPositiveInt', () => {
    expect(isPositiveInt(1)).toBe(true);
    expect(isPositiveInt(250)).toBe(true);
    expect(isPositiveInt(0)).toBe(false);
    expect(isPositiveInt(-3)).toBe(false);
    expect(isPositiveInt(1.5)).toBe(false);
    expect(isPositiveInt('5')).toBe(false);
    expect(isPositiveInt(NaN)).toBe(false);
    expect(isPositiveInt(Infinity)).toBe(false);
    expect(isPositiveInt(null)).toBe(false);
    expect(isPositiveInt(undefined)).toBe(false);
  });

  test('isValidStatus', () => {
    expect(isValidStatus('sold')).toBe(true);
    expect(isValidStatus('order_created')).toBe(true);
    expect(isValidStatus('Sold')).toBe(false);
    expect(isValidStatus('shipped')).toBe(false);
    expect(isValidStatus('')).toBe(false);
    expect(isValidStatus(undefined)).toBe(false);
    expect(isValidStatus(null)).toBe(false);
  });

  test('isPresent', () => {
    expect(isPresent(1)).toBe(true);
    expect(isPresent(0)).toBe(true);
    expect(isPresent('x')).toBe(true);
    expect(isPresent(undefined)).toBe(false);
    expect(isPresent(null)).toBe(false);
    expect(isPresent('')).toBe(false);
  });
});
