const {
  isNonEmptyString,
  isPositiveInt,
  isValidStatus,
  isPresent
} = require('../validation');

describe('validation helpers', () => {
  // Each helper is called with every value; the expected answers are listed next to them.
  const check = (fn, yes, no) => {
    for (const v of yes) expect([fn.name, v, fn(v)]).toEqual([fn.name, v, true]);
    for (const v of no) expect([fn.name, v, fn(v)]).toEqual([fn.name, v, false]);
  };

  test('isNonEmptyString, isPositiveInt, isValidStatus and isPresent accept and reject the right values', () => {
    check(isNonEmptyString, ['retail', ' a '], ['', '   ', undefined, null, 5, {}]);
    check(isPositiveInt, [1, 250], [0, -3, 1.5, '5', NaN, Infinity, null, undefined]);
    check(isValidStatus, ['sold', 'order_created'], ['Sold', 'shipped', '', undefined, null]);
    check(isPresent, [1, 0, 'x'], [undefined, null, '']);
  });
});
