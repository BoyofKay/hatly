import { REQUIRED_ACTION_TEXT, requiredActionFor } from './order-exceptions.types';

describe('requiredActionFor — what has to happen next, derived from the state (never stored)', () => {
  const base = { type: 'ITEM_UNAVAILABLE' as const, customerDecision: null, isolationCode: null };

  it('a financially isolated case always asks for a person to review it, whatever else is true', () => {
    expect(requiredActionFor({ ...base, status: 'AWAITING_OPERATIONS', isolationCode: 'ORDER_WOULD_BE_EMPTY' })).toBe('REVIEW_ISOLATED_CASE');
    expect(requiredActionFor({ ...base, status: 'ESCALATED', isolationCode: 'ITEM_AMOUNT_UNKNOWN' })).toBe('REVIEW_ISOLATED_CASE');
    expect(REQUIRED_ACTION_TEXT.REVIEW_ISOLATED_CASE).toMatch(/Nothing was changed/);
  });

  it('follows the state of the case', () => {
    expect(requiredActionFor({ ...base, status: 'ESCALATED' })).toBe('DECIDE_ESCALATION');
    expect(requiredActionFor({ ...base, status: 'AWAITING_OPERATIONS', customerDecision: 'CANCEL_ORDER' })).toBe('EXECUTE_CANCELLATION');
    expect(requiredActionFor({ ...base, status: 'AWAITING_OPERATIONS' })).toBe('CONTACT_CUSTOMER');
    expect(requiredActionFor({ ...base, status: 'AWAITING_CUSTOMER' })).toBe('FOLLOW_UP_CUSTOMER');
    expect(requiredActionFor({ ...base, status: 'OPEN' })).toBe('REVIEW');
  });

  it('a closed case needs nothing', () => {
    expect(requiredActionFor({ ...base, status: 'RESOLVED' })).toBeNull();
    expect(requiredActionFor({ ...base, status: 'WITHDRAWN', isolationCode: 'ORDER_WOULD_BE_EMPTY' })).toBeNull();
  });
});
