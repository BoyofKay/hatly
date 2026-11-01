import { orderItemGrossAmountMinor } from './order-item-removal.service';
import { PricingUnit } from '../../products/pricing-unit.enum';
import { OrderItem } from '../entities/order-item.entity';

const item = (p: Partial<OrderItem>): OrderItem => ({ productId: 'p', quantity: 1, unitPriceMinor: 1000, pricingUnitSnapshot: PricingUnit.PIECE, ...p }) as OrderItem;

describe('orderItemGrossAmountMinor — the amount an item contributes to its segment subtotal', () => {
  it('a piece item is unit price (options included) × quantity; bigint strings from the database are accepted', () => {
    expect(orderItemGrossAmountMinor(item({ quantity: 3, unitPriceMinor: 2550 }))).toBe(7650);
    expect(orderItemGrossAmountMinor(item({ quantity: 2, unitPriceMinor: '1250' as unknown as number }))).toBe(2500);
  });

  it('a weighed item is its recorded final amount when there is one, otherwise the estimate (C4 path: nothing is recalculated here)', () => {
    expect(orderItemGrossAmountMinor(item({ pricingUnitSnapshot: PricingUnit.WEIGHT, estimatedAmountMinor: 10000, finalAmountMinor: null }))).toBe(10000);
    expect(orderItemGrossAmountMinor(item({ pricingUnitSnapshot: PricingUnit.WEIGHT, estimatedAmountMinor: 10000, finalAmountMinor: 15000 }))).toBe(15000);
    expect(orderItemGrossAmountMinor(item({ pricingUnitSnapshot: PricingUnit.WEIGHT, estimatedAmountMinor: null, finalAmountMinor: null }))).toBeNull();
  });

  it('an amount that is not known is never guessed: custom / Hatly-Service items (no product) and items without a unit price', () => {
    expect(orderItemGrossAmountMinor(item({ productId: null }))).toBeNull();
    expect(orderItemGrossAmountMinor(item({ unitPriceMinor: null }))).toBeNull();
  });
});
