import { NotFoundException } from '@nestjs/common';
import { CustomerOrdersService } from './customer-orders.service';
import { OrderStatus } from './order-status.enum';

function buildHarness(params: {
  orders: any[];
  branches?: any[];
  payments?: any[];
  deliveries?: any[];
  drivers?: any[];
}) {
  const orders = params.orders;
  const branches = new Map((params.branches ?? []).map((b) => [b.id, b]));
  const payments = params.payments ?? [];
  const deliveries = params.deliveries ?? [];
  const drivers = new Map((params.drivers ?? []).map((d) => [d.id, d]));

  const ordersRepository = {
    findAndCount: jest.fn(async (opts: any) => {
      let filtered = orders.filter((o) => o.customerId === opts.where.customerId);
      if (opts.where.status) {
        // an exact status, or TypeORM's In([...]) FindOperator (the list tabs)
        const wanted = opts.where.status;
        const allowed = Array.isArray(wanted?.value) ? wanted.value : [wanted];
        filtered = filtered.filter((o) => allowed.includes(o.status));
      }
      filtered = [...filtered].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      const total = filtered.length;
      const page = filtered.slice(opts.skip, opts.skip + opts.take);
      return [page, total];
    }),
    findOne: jest.fn(async (opts: any) => orders.find((o) => o.id === opts.where.id) ?? null),
  };
  const vendorBranchesRepository = {
    find: jest.fn(async (opts: any) => {
      const ids = (opts.where as any[]).map((w) => w.id);
      return ids.map((id) => branches.get(id)).filter(Boolean);
    }),
  };
  const paymentsRepository = {
    findOne: jest.fn(async (opts: any) => payments.find((p) => p.orderId === opts.where.orderId) ?? null),
  };
  const deliveriesRepository = {
    findOne: jest.fn(async (opts: any) => deliveries.find((d) => d.orderId === opts.where.orderId) ?? null),
  };
  const driversRepository = {
    findOne: jest.fn(async (opts: any) => drivers.get(opts.where.id) ?? null),
  };

  const service = new CustomerOrdersService(
    ordersRepository as any,
    vendorBranchesRepository as any,
    paymentsRepository as any,
    deliveriesRepository as any,
    driversRepository as any,
    { find: jest.fn(async () => []) } as any, // order status events (timeline)
    { compute: jest.fn(async () => ({ state: 'UNAVAILABLE', reason: 'TEST', estimatedAt: null, estimatedUntil: null, delayed: false })) } as any,
  );
  return { service };
}

function makeOrder(overrides: Partial<any> = {}) {
  return {
    id: 'order-1',
    customerId: 'customer-1',
    status: OrderStatus.DELIVERED,
    createdAt: new Date('2026-01-01T10:00:00Z'),
    subtotalMinor: 2000,
    deliveryFeeMinor: 900,
    discountMinor: 0,
    totalMinor: 2900,
    paymentMethod: 'COD',
    cancellationReason: null,
    cancelledByRole: null,
    deliveryAddressSnapshot: { line1: '12 Market St', latitude: 30.1, longitude: 31.2 },
    segments: [],
    ...overrides,
  };
}

describe('CustomerOrdersService.listForCustomer', () => {
  it('returns only the requesting customer\'s own orders, never another customer\'s', async () => {
    const { service } = buildHarness({
      orders: [
        makeOrder({ id: 'order-1', customerId: 'customer-1' }),
        makeOrder({ id: 'order-2', customerId: 'customer-2' }),
      ],
    });

    const result = await service.listForCustomer('customer-1', {});
    expect(result.data).toHaveLength(1);
    expect(result.data[0].id).toBe('order-1');
  });

  it('defaults to newest-first ordering and page 1 / limit 20', async () => {
    const { service } = buildHarness({
      orders: [
        makeOrder({ id: 'older', createdAt: new Date('2026-01-01T00:00:00Z') }),
        makeOrder({ id: 'newer', createdAt: new Date('2026-02-01T00:00:00Z') }),
      ],
    });

    const result = await service.listForCustomer('customer-1', {});
    expect(result.data.map((o) => o.id)).toEqual(['newer', 'older']);
    expect(result.page).toBe(1);
    expect(result.limit).toBe(20);
  });

  it('applies the optional status filter using existing OrderStatus values', async () => {
    const { service } = buildHarness({
      orders: [
        makeOrder({ id: 'delivered-1', status: OrderStatus.DELIVERED }),
        makeOrder({ id: 'cancelled-1', status: OrderStatus.CANCELLED }),
      ],
    });

    const result = await service.listForCustomer('customer-1', { status: OrderStatus.CANCELLED });
    expect(result.data).toHaveLength(1);
    expect(result.data[0].id).toBe('cancelled-1');
  });

  it('respects page/limit pagination', async () => {
    const { service } = buildHarness({
      orders: [1, 2, 3].map((n) => makeOrder({ id: `order-${n}`, createdAt: new Date(2026, 0, n) })),
    });

    const result = await service.listForCustomer('customer-1', { page: 2, limit: 1 });
    expect(result.total).toBe(3);
    expect(result.data).toHaveLength(1);
    expect(result.page).toBe(2);
    expect(result.limit).toBe(1);
  });

  it('caps a garbage/malicious limit at the sanity ceiling', async () => {
    const { service } = buildHarness({ orders: [makeOrder()] });
    const result = await service.listForCustomer('customer-1', { limit: 9999 });
    expect(result.limit).toBe(50);
  });

  it('returns a vendor/branch name per segment for multi-vendor summary formatting', async () => {
    const { service } = buildHarness({
      orders: [
        makeOrder({
          segments: [
            { vendorBranchId: 'branch-a' },
            { vendorBranchId: 'branch-b' },
          ],
        }),
      ],
      branches: [
        { id: 'branch-a', name: 'Branch A', vendor: { name: 'Pizza House' } },
        { id: 'branch-b', name: 'Branch B', vendor: { name: 'Burger Place' } },
      ],
    });

    const result = await service.listForCustomer('customer-1', {});
    expect(result.data[0].vendorBranchNames).toEqual(['Pizza House', 'Burger Place']);
  });

  it('excludes an AD_HOC_SERVICE segment (no vendorBranchId) from the vendor summary', async () => {
    const { service } = buildHarness({
      orders: [makeOrder({ segments: [{ vendorBranchId: null }] })],
    });

    const result = await service.listForCustomer('customer-1', {});
    expect(result.data[0].vendorBranchNames).toEqual([]);
  });
});

describe('CustomerOrdersService.getForCustomer', () => {
  it('returns full order details for the owning customer', async () => {
    const { service } = buildHarness({
      orders: [
        makeOrder({
          segments: [
            {
              id: 'seg-1',
              groupType: 'CATALOG',
              vendorBranchId: 'branch-1',
              status: 'PICKED_UP',
              subtotalMinor: 2000,
              items: [
                {
                  id: 'item-1',
                  productId: 'product-1',
                  productNameSnapshot: 'Burger',
                  productImageUrlSnapshot: 'https://cdn/burger.png',
                  quantity: 2,
                  unitPriceMinor: 1000,
                  optionsSnapshot: [],
                  notes: null,
                  pricingUnitSnapshot: null,
                  requestedWeightGrams: null,
                  actualWeightGrams: null,
                  estimatedAmountMinor: null,
                  finalAmountMinor: null,
                  freeTextDescriptionSnapshot: null,
                  imageUrlsSnapshot: null,
                },
              ],
            },
          ],
        }),
      ],
      branches: [{ id: 'branch-1', name: 'Branch 1', vendor: { name: 'Pizza House' } }],
    });

    const details = await service.getForCustomer('customer-1', 'order-1');

    expect(details.segments[0].vendorBranchName).toBe('Pizza House');
    // Historical snapshot values used, never a live catalog re-read.
    expect(details.segments[0].items[0].productNameSnapshot).toBe('Burger');
    expect(details.segments[0].items[0].productImageUrlSnapshot).toBe('https://cdn/burger.png');
  });

  it(
    'Standalone Hatly Service milestone: an AD_HOC_SERVICE segment exposes its frozen place name, service type, ' +
      'and pickup/destination coordinates — real backend columns that existed but were never returned before this fix',
    async () => {
      const { service } = buildHarness({
        orders: [
          makeOrder({
            segments: [
              {
                id: 'seg-1',
                groupType: 'AD_HOC_SERVICE',
                vendorBranchId: null,
                status: 'PICKED_UP',
                subtotalMinor: null,
                adHocPlaceNameSnapshot: 'كارفور بلبيس',
                adHocServiceTypeSnapshot: 'BUY_FROM_PLACE',
                adHocPickupLatitudeSnapshot: 30.42,
                adHocPickupLongitudeSnapshot: 31.56,
                adHocDestinationLatitudeSnapshot: null,
                adHocDestinationLongitudeSnapshot: null,
                items: [
                  {
                    id: 'item-1',
                    productId: null,
                    productNameSnapshot: null,
                    productImageUrlSnapshot: null,
                    quantity: 1,
                    unitPriceMinor: null,
                    optionsSnapshot: [],
                    notes: null,
                    pricingUnitSnapshot: null,
                    requestedWeightGrams: null,
                    actualWeightGrams: null,
                    estimatedAmountMinor: null,
                    finalAmountMinor: null,
                    freeTextDescriptionSnapshot: 'عايز 2 كيلو رز بسمتي',
                    imageUrlsSnapshot: ['https://cdn/rice.jpg'],
                  },
                ],
              },
            ],
          }),
        ],
      });

      const details = await service.getForCustomer('customer-1', 'order-1');
      const segment = details.segments[0];

      expect(segment.adHocPlaceNameSnapshot).toBe('كارفور بلبيس');
      expect(segment.adHocServiceTypeSnapshot).toBe('BUY_FROM_PLACE');
      expect(segment.adHocPickupLatitudeSnapshot).toBe(30.42);
      expect(segment.adHocPickupLongitudeSnapshot).toBe(31.56);
      expect(segment.adHocDestinationLatitudeSnapshot).toBeNull();
      expect(segment.adHocDestinationLongitudeSnapshot).toBeNull();
      expect(segment.items[0].freeTextDescriptionSnapshot).toBe('عايز 2 كيلو رز بسمتي');
      expect(segment.items[0].imageUrlsSnapshot).toEqual(['https://cdn/rice.jpg']);
    },
  );

  it('Customer Order Details exposure fix: a normal catalog item exposes actualAmountMinor as null (unchanged unitPriceMinor path)', async () => {
    const { service } = buildHarness({
      orders: [
        makeOrder({
          segments: [
            {
              id: 'seg-1',
              groupType: 'CATALOG',
              vendorBranchId: 'branch-1',
              status: 'PICKED_UP',
              subtotalMinor: 2000,
              items: [
                {
                  id: 'item-1',
                  productId: 'product-1',
                  productNameSnapshot: 'Burger',
                  productImageUrlSnapshot: null,
                  quantity: 2,
                  unitPriceMinor: 1000,
                  optionsSnapshot: [],
                  notes: null,
                  pricingUnitSnapshot: null,
                  requestedWeightGrams: null,
                  actualWeightGrams: null,
                  estimatedAmountMinor: null,
                  finalAmountMinor: null,
                  freeTextDescriptionSnapshot: null,
                  imageUrlsSnapshot: null,
                  actualAmountMinor: null,
                },
              ],
            },
          ],
        }),
      ],
      branches: [{ id: 'branch-1', name: 'Branch 1', vendor: { name: 'Pizza House' } }],
    });

    const details = await service.getForCustomer('customer-1', 'order-1');
    expect(details.segments[0].items[0].unitPriceMinor).toBe(1000);
    expect(details.segments[0].items[0].actualAmountMinor).toBeNull();
  });

  it('CRITICAL: a Custom Item with actualAmountMinor still null returns null (not yet priced — Customer UI keeps showing "Price will be confirmed")', async () => {
    const { service } = buildHarness({
      orders: [
        makeOrder({
          segments: [
            {
              id: 'seg-1',
              groupType: 'CATALOG',
              vendorBranchId: 'branch-1',
              status: 'PICKED_UP',
              subtotalMinor: 2000,
              items: [
                {
                  id: 'item-2',
                  productId: null,
                  productNameSnapshot: null,
                  productImageUrlSnapshot: null,
                  quantity: 1,
                  unitPriceMinor: null,
                  optionsSnapshot: [],
                  notes: null,
                  pricingUnitSnapshot: null,
                  requestedWeightGrams: null,
                  actualWeightGrams: null,
                  estimatedAmountMinor: null,
                  finalAmountMinor: null,
                  freeTextDescriptionSnapshot: 'Panadol Extra 500mg',
                  imageUrlsSnapshot: null,
                  actualAmountMinor: null,
                },
              ],
            },
          ],
        }),
      ],
      branches: [{ id: 'branch-1', name: 'Branch 1', vendor: { name: 'Pharmacy X' } }],
    });

    const details = await service.getForCustomer('customer-1', 'order-1');
    expect(details.segments[0].items[0].unitPriceMinor).toBeNull();
    expect(details.segments[0].items[0].actualAmountMinor).toBeNull();
  });

  it('CRITICAL: a Custom Item with a recorded actualAmountMinor exposes the final amount, while unitPriceMinor stays null', async () => {
    const { service } = buildHarness({
      orders: [
        makeOrder({
          segments: [
            {
              id: 'seg-1',
              groupType: 'CATALOG',
              vendorBranchId: 'branch-1',
              status: 'PICKED_UP',
              subtotalMinor: 2000,
              items: [
                {
                  id: 'item-3',
                  productId: null,
                  productNameSnapshot: null,
                  productImageUrlSnapshot: null,
                  quantity: 1,
                  unitPriceMinor: null,
                  optionsSnapshot: [],
                  notes: null,
                  pricingUnitSnapshot: null,
                  requestedWeightGrams: null,
                  actualWeightGrams: null,
                  estimatedAmountMinor: null,
                  finalAmountMinor: null,
                  freeTextDescriptionSnapshot: 'Panadol Extra 500mg',
                  imageUrlsSnapshot: null,
                  actualAmountMinor: 5000,
                },
              ],
            },
          ],
        }),
      ],
      branches: [{ id: 'branch-1', name: 'Branch 1', vendor: { name: 'Pharmacy X' } }],
    });

    const details = await service.getForCustomer('customer-1', 'order-1');
    expect(details.segments[0].items[0].actualAmountMinor).toBe(5000);
    expect(details.segments[0].items[0].unitPriceMinor).toBeNull();
  });

  it('rejects a request for another customer\'s order — not found, never forbidden (no leak)', async () => {
    const { service } = buildHarness({ orders: [makeOrder({ customerId: 'customer-1' })] });
    await expect(service.getForCustomer('someone-else', 'order-1')).rejects.toThrow(NotFoundException);
  });

  it('rejects a non-existent order the same way as someone else\'s order', async () => {
    const { service } = buildHarness({ orders: [] });
    await expect(service.getForCustomer('customer-1', 'missing')).rejects.toThrow(NotFoundException);
  });

  it('reads the Payment ROW only for MANUAL_TRANSFER — COD/PAY_AT_DELIVERY never get a fabricated payment record (their view is derived from the order itself)', async () => {
    const { service } = buildHarness({
      orders: [
        makeOrder({ id: 'order-cod', paymentMethod: 'COD' }),
        makeOrder({ id: 'order-pad', paymentMethod: 'PAY_AT_DELIVERY', electronicPaymentMethod: 'ORANGE_CASH' }),
        makeOrder({ id: 'order-mt', paymentMethod: 'MANUAL_TRANSFER' }),
      ],
      payments: [{ orderId: 'order-mt', method: 'MANUAL_TRANSFER', status: 'PENDING', amountMinor: 2900 }],
    });

    const cod = await service.getForCustomer('customer-1', 'order-cod');
    expect(cod.payment).toMatchObject({ method: 'COD', status: 'DUE_ON_DELIVERY', amountMinor: null, electronicMethod: null, awaitingApproval: false });

    // Pay-at-Delivery is NOT COD: it is electronic, and the chosen method is kept.
    const pad = await service.getForCustomer('customer-1', 'order-pad');
    expect(pad.payment).toMatchObject({ method: 'PAY_AT_DELIVERY', status: 'DUE_ON_DELIVERY', amountMinor: null, electronicMethod: 'ORANGE_CASH', awaitingApproval: false });

    const mtDetails = await service.getForCustomer('customer-1', 'order-mt');
    expect(mtDetails.payment).toMatchObject({ method: 'MANUAL_TRANSFER', status: 'PENDING', amountMinor: 2900, awaitingApproval: true });
  });

  it('surfaces driver name + phone only when a Driver is actually assigned via Delivery.driverId', async () => {
    const { service } = buildHarness({
      orders: [makeOrder({ id: 'order-1' })],
      deliveries: [{ orderId: 'order-1', driverId: 'driver-1' }],
      drivers: [{ id: 'driver-1', user: { fullName: 'Ahmed Hassan', phone: '+201234567890' } }],
    });

    const details = await service.getForCustomer('customer-1', 'order-1');
    expect(details.driver).toEqual({ name: 'Ahmed Hassan', phone: '+201234567890' });
  });

  it('returns a null driver when no delivery/driver is assigned yet', async () => {
    const { service } = buildHarness({ orders: [makeOrder({ id: 'order-1' })] });
    const details = await service.getForCustomer('customer-1', 'order-1');
    expect(details.driver).toBeNull();
  });

  it('never exposes live driver location fields — not read, not returned', async () => {
    const { service } = buildHarness({
      orders: [makeOrder({ id: 'order-1' })],
      deliveries: [{ orderId: 'order-1', driverId: 'driver-1' }],
      drivers: [
        {
          id: 'driver-1',
          user: { fullName: 'Ahmed Hassan', phone: '+201234567890' },
          lastLatitude: 30.5,
          lastLongitude: 31.5,
        },
      ],
    });

    const details = await service.getForCustomer('customer-1', 'order-1');
    expect(details.driver).toEqual({ name: 'Ahmed Hassan', phone: '+201234567890' });
    expect(Object.keys(details.driver!)).toEqual(['name', 'phone']); // nothing else leaks through
  });

  it('preserves cancellation info as customer-safe fields', async () => {
    const { service } = buildHarness({
      orders: [
        makeOrder({
          status: OrderStatus.CANCELLED,
          cancellationReason: 'Vendor unable to fulfill',
          cancelledByRole: 'VENDOR',
        }),
      ],
    });

    const details = await service.getForCustomer('customer-1', 'order-1');
    expect(details.cancellationReason).toBe('Vendor unable to fulfill');
    expect(details.cancelledByRole).toBe('VENDOR');
  });

  it('CRITICAL: a FAILED_DELIVERY order returns the real failureReason and failedAt', async () => {
    const { service } = buildHarness({
      orders: [
        makeOrder({
          status: OrderStatus.FAILED_DELIVERY,
          failureReason: 'Customer not reachable',
          failedAt: new Date('2026-02-01T14:30:00Z'),
        }),
      ],
    });

    const details = await service.getForCustomer('customer-1', 'order-1');
    expect(details.failureReason).toBe('Customer not reachable');
    expect(details.failedAt).toBe('2026-02-01T14:30:00.000Z');
  });

  it('a non-FAILED_DELIVERY order returns both failureReason and failedAt as null', async () => {
    const { service } = buildHarness({
      orders: [makeOrder({ status: OrderStatus.DELIVERED })],
    });

    const details = await service.getForCustomer('customer-1', 'order-1');
    expect(details.failureReason).toBeNull();
    expect(details.failedAt).toBeNull();
  });
});

describe('CustomerOrdersService — PD-006 views', () => {
  const seg = (overrides: any = {}) => ({
    id: 'seg-1',
    groupType: 'CATALOG',
    vendorBranchId: 'branch-1',
    status: 'PENDING',
    subtotalMinor: 2000,
    items: [{ id: 'item-1', productNameSnapshot: 'Burger', productNameArSnapshot: 'برجر', productImageUrlSnapshot: 'https://cdn/b.png', quantity: 1, optionsSnapshot: [] }],
    ...overrides,
  });

  it.each([
    ['active', [OrderStatus.PENDING, OrderStatus.CONFIRMED, OrderStatus.PREPARING, OrderStatus.READY_FOR_PICKUP, OrderStatus.ASSIGNED_TO_DRIVER, OrderStatus.PICKED_UP, OrderStatus.ON_THE_WAY]],
    ['completed', [OrderStatus.DELIVERED, OrderStatus.COLLECTED]], // U2: a collected pickup order is completed
    ['cancelled', [OrderStatus.CANCELLED, OrderStatus.FAILED_DELIVERY]],
  ] as const)('the "%s" tab lists exactly its own statuses', async (tab, statuses) => {
    const everyStatus = Object.values(OrderStatus);
    const { service } = buildHarness({ orders: everyStatus.map((status) => makeOrder({ id: `o-${status}`, status })) });
    const result = await service.listForCustomer('customer-1', { tab, limit: 50 });
    expect(result.data.map((o) => o.id).sort()).toEqual(statuses.map((st) => `o-${st}`).sort());
  });

  it('every order lands in exactly one tab (nothing is lost, nothing is duplicated)', async () => {
    const everyStatus = Object.values(OrderStatus);
    const { service } = buildHarness({ orders: everyStatus.map((status) => makeOrder({ id: `o-${status}`, status })) });
    const ids = (await Promise.all((['active', 'completed', 'cancelled'] as const).map((tab) => service.listForCustomer('customer-1', { tab, limit: 50 })))).flatMap((r) => r.data.map((o) => o.id));
    expect(ids.sort()).toEqual(everyStatus.map((st) => `o-${st}`).sort());
  });

  it('a list card carries product images from the ORDER SNAPSHOT (max 3), the frozen vendor name, payment choice and awaiting-approval', async () => {
    const items = [1, 2, 3, 4].map((n) => ({ id: `i${n}`, productImageUrlSnapshot: `https://cdn/${n}.png` }));
    const { service } = buildHarness({
      orders: [makeOrder({ paymentMethod: 'MANUAL_TRANSFER', electronicPaymentMethod: 'INSTAPAY', segments: [seg({ vendorNameSnapshot: 'Frozen Name', items })] })],
      branches: [{ id: 'branch-1', name: 'Renamed Later', vendor: { name: 'Renamed Later' } }],
      payments: [{ orderId: 'order-1', method: 'MANUAL_TRANSFER', status: 'UNDER_REVIEW', amountMinor: 2900 }],
    });
    const [card] = (await service.listForCustomer('customer-1', {})).data;
    expect(card.itemImageUrls).toEqual(['https://cdn/1.png', 'https://cdn/2.png', 'https://cdn/3.png']);
    expect(card.itemCount).toBe(4);
    expect(card.vendorBranchNames).toEqual(['Frozen Name']); // history never follows a later rename
    expect(card).toMatchObject({ electronicPaymentMethod: 'INSTAPAY', awaitingPaymentApproval: true });
  });

  it('a rejected or approved transfer is no longer "awaiting approval"', async () => {
    const { service } = buildHarness({
      orders: [makeOrder({ id: 'a', paymentMethod: 'MANUAL_TRANSFER' }), makeOrder({ id: 'b', paymentMethod: 'MANUAL_TRANSFER' })],
      payments: [
        { orderId: 'a', status: 'PAID', amountMinor: 1 },
        { orderId: 'b', status: 'REJECTED', amountMinor: 1 },
      ],
    });
    const cards = (await service.listForCustomer('customer-1', {})).data;
    expect(cards.map((c) => c.awaitingPaymentApproval)).toEqual([false, false]);
  });

  it('details use the frozen vendor / branch / product-name snapshots, never the live records', async () => {
    const { service } = buildHarness({
      orders: [makeOrder({ segments: [seg({ vendorNameSnapshot: 'Frozen Vendor', branchAddressSnapshot: '5 Old St', couponCodeSnapshot: 'SAVE10' })] })],
      branches: [{ id: 'branch-1', name: 'Live Name', vendor: { name: 'Live Name' } }],
    });
    const details = await service.getForCustomer('customer-1', 'order-1');
    expect(details.segments[0]).toMatchObject({ vendorBranchName: 'Frozen Vendor', branchAddress: '5 Old St', couponCodeSnapshot: 'SAVE10' });
    expect(details.segments[0].items[0].productNameArSnapshot).toBe('برجر');
  });

  it('details expose the frozen payment choice, wallet amount, amount due, coupon and address snapshot', async () => {
    const coupon = { code: 'SAVE10', offerId: 'o1', offerName: 'Ten', vendorBranchId: 'branch-1', orderVendorSegmentId: 'seg-1', discountMinor: 300 };
    const { service } = buildHarness({
      orders: [makeOrder({ paymentMethod: 'COD', walletAmountMinor: 1000, amountDueMinor: 1900, couponSnapshot: coupon, segments: [seg()] })],
    });
    const d = await service.getForCustomer('customer-1', 'order-1');
    expect(d).toMatchObject({ walletAmountMinor: 1000, amountDueMinor: 1900, coupon, electronicPaymentMethod: null });
    expect(d.deliveryAddressSnapshot).toEqual({ line1: '12 Market St', latitude: 30.1, longitude: 31.2 });
  });

  it('a wallet-only order reads as PAID', async () => {
    const { service } = buildHarness({ orders: [makeOrder({ paymentMethod: 'WALLET', walletAmountMinor: 2900, amountDueMinor: 0, segments: [seg()] })] });
    expect((await service.getForCustomer('customer-1', 'order-1')).payment).toMatchObject({ method: 'WALLET', status: 'PAID', walletAmountMinor: 2900, amountDueMinor: 0 });
  });

  it('the delivery breakdown shows the frozen base / additional-vendor fee — and hides internal route legs', async () => {
    const snapshot = {
      vendorSequence: [{ vendorBranchId: 'b1', distanceToCustomerMeters: 3000 }, { vendorBranchId: 'b2', distanceToCustomerMeters: 1000 }],
      legDistancesMeters: [2500, 1000],
      roundedTotalDistanceMeters: 3500,
      additionalVendorFeeMinorUsed: 500,
      additionalVendorChargeMinor: 500,
      deliveryFeeMinor: 2500,
    };
    const { service } = buildHarness({ orders: [makeOrder({ deliveryFeeBreakdownSnapshot: snapshot, segments: [seg()] })] });
    const d = await service.getForCustomer('customer-1', 'order-1');
    expect(d.deliveryBreakdown).toEqual({
      baseFeeMinor: 2000,
      additionalVendorFeeMinor: 500,
      additionalVendorChargeMinor: 500,
      vendorCount: 2,
      pricingSource: 'DISTANCE',
      distanceMeters: 3500,
      frozenTotalFeeMinor: 2500,
      vendors: [{ vendorBranchId: 'b1', distanceToCustomerMeters: 3000 }, { vendorBranchId: 'b2', distanceToCustomerMeters: 1000 }],
    });
    expect(JSON.stringify(d)).not.toContain('legDistancesMeters');
  });

  it('a pickup / ad-hoc order has no delivery breakdown', async () => {
    const { service } = buildHarness({ orders: [makeOrder({ deliveryFeeBreakdownSnapshot: null, segments: [seg()] })] });
    expect((await service.getForCustomer('customer-1', 'order-1')).deliveryBreakdown).toBeNull();
  });

  it('customerCanCancel follows the server rule: PENDING/CONFIRMED and no vendor preparing yet', async () => {
    const cases: Array<[OrderStatus, string, boolean]> = [
      [OrderStatus.PENDING, 'PENDING', true],
      [OrderStatus.CONFIRMED, 'CONFIRMED', true],
      [OrderStatus.PENDING, 'PREPARING', false], // order still PENDING, but a vendor has started
      [OrderStatus.PREPARING, 'PREPARING', false],
      [OrderStatus.DELIVERED, 'PICKED_UP', false],
    ];
    for (const [status, segStatus, expected] of cases) {
      const { service } = buildHarness({ orders: [makeOrder({ status, segments: [seg({ status: segStatus })] })] });
      expect((await service.getForCustomer('customer-1', 'order-1')).customerCanCancel).toBe(expected);
    }
  });

  it('tracking: status, ETA, timeline and per-vendor progress — and NO driver or location field at all', async () => {
    const { service } = buildHarness({
      orders: [makeOrder({ status: OrderStatus.PENDING, paymentMethod: 'MANUAL_TRANSFER', electronicPaymentMethod: 'WE_PAY', segments: [seg({ vendorNameSnapshot: 'Frozen', status: 'CONFIRMED', preparationEstimateMinutes: 20 })] })],
      payments: [{ orderId: 'order-1', status: 'PENDING', amountMinor: 2900 }],
      deliveries: [{ orderId: 'order-1', driverId: 'driver-1' }],
      drivers: [{ id: 'driver-1', user: { fullName: 'Ahmed', phone: '+2012' } }],
    });
    const t = await service.trackForCustomer('customer-1', 'order-1');
    expect(t).toMatchObject({
      orderId: 'order-1',
      status: OrderStatus.PENDING,
      segments: [{ id: 'seg-1', vendorName: 'Frozen', status: 'CONFIRMED', preparationEstimateMinutes: 20 }],
      payment: { method: 'MANUAL_TRANSFER', electronicMethod: 'WE_PAY', status: 'PENDING', awaitingApproval: true },
      customerCanCancel: true,
    });
    const json = JSON.stringify(t);
    for (const forbidden of ['driver', 'Ahmed', '+2012', 'latitude', 'longitude', 'lastLocation']) expect(json).not.toContain(forbidden);
  });

  it("tracking is the owner's only: another customer gets a 404", async () => {
    const { service } = buildHarness({ orders: [makeOrder({ customerId: 'someone-else', segments: [seg()] })] });
    await expect(service.trackForCustomer('customer-1', 'order-1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it(
    'Standalone Hatly Service milestone: tracking falls back to the frozen place name for an AD_HOC_SERVICE ' +
      "segment (no vendorNameSnapshot/vendorBranchId exist for it) — never a blank vendor name",
    async () => {
      const { service } = buildHarness({
        orders: [
          makeOrder({
            segments: [
              seg({
                groupType: 'AD_HOC_SERVICE',
                vendorBranchId: null,
                subtotalMinor: null,
                adHocPlaceNameSnapshot: 'صيدلية النور',
              }),
            ],
          }),
        ],
      });

      const t = await service.trackForCustomer('customer-1', 'order-1');
      expect(t.segments[0].vendorName).toBe('صيدلية النور');
    },
  );
});
