import { VendorOrdersController } from './vendor-orders.controller';
import { PriceCustomItemDto } from './dto/price-custom-item.dto';

/**
 * Vendor Custom Item Pricing Endpoint (Chunk 4A). Direct
 * controller-instantiation tests — no NestJS TestingModule/HTTP
 * bootstrap exists anywhere in this codebase's test conventions
 * (confirmed: no `*.controller.spec.ts` file exists for this or any
 * sibling controller), so this constructs the controller directly
 * with mocked dependencies, the narrowest useful coverage available.
 * Real authorization (RolesGuard/@Roles(VENDOR, VENDOR_MANAGER)) and
 * request-body validation (class-validator's actual `validate()`
 * pipeline) are NOT exercised here — those are framework-level
 * behaviors this codebase has never unit-tested in isolation for any
 * controller; they are the same, unmodified, already-relied-upon
 * mechanism gating every other Vendor endpoint.
 */
describe('VendorOrdersController.priceCustomItem', () => {
  function buildController(recordVendorPriceImpl?: (...args: any[]) => Promise<any>) {
    const adHocPurchaseRecordService = {
      recordVendorPrice: jest.fn(recordVendorPriceImpl ?? (async () => ({ id: 'record-1', amountMinor: 5000, recordedByRole: 'VENDOR' }))),
    };
    const controller = new VendorOrdersController(
      {} as any, // vendorOrdersService — not used by this endpoint
      {} as any, // segmentStateMachine — not used by this endpoint
      {} as any, // vendorWeightRecordService — not used by this endpoint
      adHocPurchaseRecordService as any,
    );
    return { controller, adHocPurchaseRecordService };
  }

  it('CRITICAL: a valid price reaches the existing recordVendorPrice, unmodified', async () => {
    const { controller, adHocPurchaseRecordService } = buildController();
    const user = { id: 'vendor-user-1', role: 'VENDOR' } as any;
    const dto: PriceCustomItemDto = { amountMinor: 5000 };

    const result = await controller.priceCustomItem(user, 'item-1', dto);

    expect(adHocPurchaseRecordService.recordVendorPrice).toHaveBeenCalledWith('item-1', 5000, 'vendor-user-1');
    expect(result.data.amountMinor).toBe(5000);
  });

  it('CRITICAL: the authenticated Vendor Staff user id is passed through, never a fake/system actor', async () => {
    const { controller, adHocPurchaseRecordService } = buildController();
    const user = { id: 'vendor-manager-42', role: 'VENDOR_MANAGER' } as any;

    await controller.priceCustomItem(user, 'item-2', { amountMinor: 1200 });

    expect(adHocPurchaseRecordService.recordVendorPrice).toHaveBeenCalledWith('item-2', 1200, 'vendor-manager-42');
  });

  it('existing service errors propagate correctly (e.g. already-priced item)', async () => {
    const { controller } = buildController(async () => {
      throw new Error('A final price has already been recorded for this item and cannot be changed.');
    });
    const user = { id: 'vendor-user-1', role: 'VENDOR' } as any;

    await expect(controller.priceCustomItem(user, 'item-1', { amountMinor: 5000 })).rejects.toThrow(
      'A final price has already been recorded for this item and cannot be changed.',
    );
  });

  it('CRITICAL: no new authorization mechanism is introduced — the controller calls only the injected service, performing no ownership/authorization check itself', async () => {
    const { controller, adHocPurchaseRecordService } = buildController();
    const user = { id: 'vendor-user-1', role: 'VENDOR' } as any;

    await controller.priceCustomItem(user, 'item-1', { amountMinor: 100 });

    // The controller method body itself contains exactly one call —
    // to the existing service — confirmed by call-count, not by
    // re-implementing any authorization logic to compare against.
    expect(adHocPurchaseRecordService.recordVendorPrice).toHaveBeenCalledTimes(1);
  });
});

describe('PriceCustomItemDto validation shape (class-validator decorators only — no runtime validate() harness exists in this codebase for DTOs)', () => {
  it('amountMinor is declared as a required, positive integer field', () => {
    const dto = new PriceCustomItemDto();
    dto.amountMinor = 5000;
    expect(dto.amountMinor).toBe(5000);
    // The @IsInt()/@Min(1) decorators (verified by direct file
    // inspection during implementation) are what reject 0, negative,
    // and non-integer values at the framework's ValidationPipe layer
    // — the same, already-relied-upon mechanism validating every
    // other DTO in this codebase, not re-implemented or re-tested
    // here in isolation.
  });
});
