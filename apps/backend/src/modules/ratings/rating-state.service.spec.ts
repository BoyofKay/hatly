import { NotFoundException } from '@nestjs/common';
import { RatingStateService } from './rating-state.service';
import { OrderStatus } from '../orders/order-status.enum';
import { OrderVendorSegmentStatus } from '../orders/order-vendor-segment-status.enum';

function buildHarness(params: {
  order: any;
  delivery?: any;
  vendorRatings?: any[];
  driverRatings?: any[];
  productRatings?: any[];
}) {
  const ordersRepository = { findOne: jest.fn(async () => params.order) };
  const deliveriesRepository = { findOne: jest.fn(async () => params.delivery ?? null) };
  const vendorRatingsRepository = { find: jest.fn(async () => params.vendorRatings ?? []) };
  const driverRatingsRepository = { findOne: jest.fn(async () => (params.driverRatings ?? [])[0] ?? null) };
  const productRatingsRepository = { find: jest.fn(async () => params.productRatings ?? []) };

  const service = new RatingStateService(
    ordersRepository as any,
    deliveriesRepository as any,
    vendorRatingsRepository as any,
    driverRatingsRepository as any,
    productRatingsRepository as any,
  );
  return { service };
}

function baseOrder(overrides: Partial<any> = {}) {
  return {
    id: 'order-1',
    customerId: 'customer-1',
    status: OrderStatus.DELIVERED,
    segments: [
      {
        id: 'seg-1',
        vendorBranchId: 'branch-1',
        status: OrderVendorSegmentStatus.PICKED_UP,
        items: [{ id: 'item-1', productId: 'product-1', productNameSnapshot: 'Burger' }],
      },
    ],
    ...overrides,
  };
}

describe('RatingStateService', () => {
  it('returns eligible vendor segments and product items for a DELIVERED order, none rated yet', async () => {
    const { service } = buildHarness({ order: baseOrder() });

    const state = await service.getOrderRatingState('customer-1', 'order-1');

    expect(state.vendorSegments).toHaveLength(1);
    expect(state.vendorSegments[0].alreadyRated).toBe(false);
    expect(state.productItems).toHaveLength(1);
    expect(state.productItems[0].alreadyRated).toBe(false);
    expect(state.driver).toBeNull();
  });

  it('reflects an already-submitted vendor rating', async () => {
    const { service } = buildHarness({
      order: baseOrder(),
      vendorRatings: [{ orderVendorSegmentId: 'seg-1', stars: 4, comment: 'Good' }],
    });

    const state = await service.getOrderRatingState('customer-1', 'order-1');
    expect(state.vendorSegments[0].alreadyRated).toBe(true);
    expect(state.vendorSegments[0].rating).toEqual({ stars: 4, comment: 'Good' });
  });

  it('reflects an already-submitted driver rating and surfaces the delivery driver', async () => {
    const { service } = buildHarness({
      order: baseOrder(),
      delivery: { id: 'delivery-1', driverId: 'driver-1' },
      driverRatings: [{ deliveryId: 'delivery-1', stars: 5, comment: null }],
    });

    const state = await service.getOrderRatingState('customer-1', 'order-1');
    expect(state.driver).not.toBeNull();
    expect(state.driver?.driverId).toBe('driver-1');
    expect(state.driver?.alreadyRated).toBe(true);
  });

  it('excludes a CANCELLED segment from eligible vendor/product targets', async () => {
    const { service } = buildHarness({
      order: baseOrder({
        segments: [
          {
            id: 'seg-1',
            vendorBranchId: 'branch-1',
            status: OrderVendorSegmentStatus.CANCELLED,
            items: [{ id: 'item-1', productId: 'product-1', productNameSnapshot: 'Burger' }],
          },
        ],
      }),
    });

    const state = await service.getOrderRatingState('customer-1', 'order-1');
    expect(state.vendorSegments).toHaveLength(0);
    expect(state.productItems).toHaveLength(0);
  });

  it('excludes AD_HOC_SERVICE items (no productId) from eligible product targets', async () => {
    const { service } = buildHarness({
      order: baseOrder({
        segments: [
          {
            id: 'seg-1',
            vendorBranchId: null,
            status: OrderVendorSegmentStatus.PICKED_UP,
            items: [{ id: 'item-1', productId: null, productNameSnapshot: null }],
          },
        ],
      }),
    });

    const state = await service.getOrderRatingState('customer-1', 'order-1');
    expect(state.vendorSegments).toHaveLength(0); // no vendorBranchId
    expect(state.productItems).toHaveLength(0); // no productId
  });

  it('rejects when the requesting customer does not own the order', async () => {
    const { service } = buildHarness({ order: baseOrder({ customerId: 'someone-else' }) });
    await expect(service.getOrderRatingState('customer-1', 'order-1')).rejects.toThrow(NotFoundException);
  });

  it('rejects a non-DELIVERED order', async () => {
    const { service } = buildHarness({ order: baseOrder({ status: OrderStatus.CANCELLED }) });
    await expect(service.getOrderRatingState('customer-1', 'order-1')).rejects.toThrow(NotFoundException);
  });
});
