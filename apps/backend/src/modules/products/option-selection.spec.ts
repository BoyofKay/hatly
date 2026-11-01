import { assertNonNegativeUnitPrice, effectiveSelectionLimits, OptionGroupLike, validateOptionSelection } from './option-selection';

const group = (over: Partial<OptionGroupLike> = {}): OptionGroupLike => ({
  id: 'g1',
  name: 'Toppings',
  isRequired: false,
  allowsMultiple: true,
  minSelections: 0,
  maxSelections: null,
  values: [
    { id: 'a', priceDeltaMinor: 500 },
    { id: 'b', priceDeltaMinor: 1000 },
    { id: 'c', priceDeltaMinor: 0 },
    { id: 'd', priceDeltaMinor: -200 },
  ],
  ...over,
});
const codeOf = (fn: () => void) => {
  try {
    fn();
    return null;
  } catch (e: any) {
    return e.response?.details?.code ?? 'OTHER';
  }
};

describe('effectiveSelectionLimits — the original flags stay authoritative for old rows', () => {
  it('legacy rows (min 0, no max): required ⇒ at least 1; single-choice ⇒ at most 1', () => {
    expect(effectiveSelectionLimits({ isRequired: false, allowsMultiple: false, minSelections: 0, maxSelections: null })).toEqual({ min: 0, max: 1 });
    expect(effectiveSelectionLimits({ isRequired: true, allowsMultiple: false, minSelections: 0, maxSelections: null })).toEqual({ min: 1, max: 1 });
    expect(effectiveSelectionLimits({ isRequired: false, allowsMultiple: true, minSelections: 0, maxSelections: null })).toEqual({ min: 0, max: null });
  });
  it('explicit limits apply only to a multiple-choice group; columns absent (undefined) behave like the defaults', () => {
    expect(effectiveSelectionLimits({ isRequired: false, allowsMultiple: true, minSelections: 2, maxSelections: 4 })).toEqual({ min: 2, max: 4 });
    expect(effectiveSelectionLimits({ isRequired: false, allowsMultiple: false, minSelections: 0, maxSelections: 9 })).toEqual({ min: 0, max: 1 });
    expect(effectiveSelectionLimits({ isRequired: true, allowsMultiple: true })).toEqual({ min: 1, max: null });
  });
});

describe('validateOptionSelection', () => {
  it('an optional multiple group accepts none, one or many', () => {
    for (const sel of [[], ['a'], ['a', 'b', 'c']]) expect(codeOf(() => validateOptionSelection([group()], sel))).toBeNull();
  });
  it('REQUIRED with nothing chosen → OPTION_REQUIRED (the pre-existing code)', () => {
    expect(codeOf(() => validateOptionSelection([group({ isRequired: true })], []))).toBe('OPTION_REQUIRED');
  });
  it('minimum 2: none → OPTION_REQUIRED, one → OPTION_MIN_SELECTIONS, two → ok', () => {
    const g = group({ minSelections: 2 });
    expect(codeOf(() => validateOptionSelection([g], []))).toBe('OPTION_REQUIRED');
    expect(codeOf(() => validateOptionSelection([g], ['a']))).toBe('OPTION_MIN_SELECTIONS');
    expect(codeOf(() => validateOptionSelection([g], ['a', 'b']))).toBeNull();
  });
  it('maximum 2: three → OPTION_MAX_SELECTIONS', () => {
    const g = group({ maxSelections: 2 });
    expect(codeOf(() => validateOptionSelection([g], ['a', 'b']))).toBeNull();
    expect(codeOf(() => validateOptionSelection([g], ['a', 'b', 'c']))).toBe('OPTION_MAX_SELECTIONS');
  });
  it('a single-choice group refuses two values (INVALID_OPTION_SELECTION, unchanged)', () => {
    expect(codeOf(() => validateOptionSelection([group({ allowsMultiple: false })], ['a', 'b']))).toBe('INVALID_OPTION_SELECTION');
  });
  it('a value that belongs to another product is refused', () => {
    expect(codeOf(() => validateOptionSelection([group()], ['a', 'foreign']))).toBe('INVALID_OPTION_SELECTION');
  });
  it('several groups are each checked independently', () => {
    const size = group({ id: 's', name: 'Size', isRequired: true, allowsMultiple: false, values: [{ id: 'small' }, { id: 'large' }] });
    expect(codeOf(() => validateOptionSelection([size, group()], ['small', 'a']))).toBeNull();
    expect(codeOf(() => validateOptionSelection([size, group()], ['a']))).toBe('OPTION_REQUIRED');
  });
});

describe('assertNonNegativeUnitPrice', () => {
  it('base + chosen deltas may not go below zero', () => {
    expect(codeOf(() => assertNonNegativeUnitPrice(100, [group()], ['d']))).toBe('INVALID_OPTION_SELECTION'); // 1.00 - 2.00
    expect(codeOf(() => assertNonNegativeUnitPrice(1000, [group()], ['d']))).toBeNull();
  });
});
