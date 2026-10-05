const STATUSES = ['order_created', 'sold'];

const isPresent = v => v !== undefined && v !== null && v !== '';
const isNonEmptyString = v => typeof v === 'string' && v.trim() !== '';
const isPositiveInt = v => Number.isInteger(v) && v > 0;
const isValidStatus = v => STATUSES.includes(v);

module.exports = { isPresent, isNonEmptyString, isPositiveInt, isValidStatus };
