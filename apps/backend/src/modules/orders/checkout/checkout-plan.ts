import { Cart } from '../../cart/entities/cart.entity';
import { CartVendorGroup } from '../../cart/entities/cart-vendor-group.entity';
import { CartView, CartGroupView } from '../../cart/cart-view.interface';
import { FulfillmentType } from '../../cart/fulfillment-type.enum';
import { VendorBranch } from '../../vendors/entities/vendor-branch.entity';
import { DeliveryFeeBreakdown } from '../../delivery-fee/delivery-fee-calculation.service';
import { OfferItemPlan, OfferSegmentPlan } from '../../offers/offer-consumption.service';
import { ElectronicPaymentMethod } from '../../payments/electronic-payment-method.enum';
import { DeliveryAddressSnapshot } from '../entities/order.entity';
import { OrderPaymentMethod } from '../order-payment-method';

/** What the customer asked for at checkout. Nothing here is an authoritative amount. */
export interface CheckoutInput {
  customerId: string;
  /** The resolved delivery address (a saved address is turned into a snapshot by the caller). Null for pickup. */
  address: DeliveryAddressSnapshot | null;
  paymentMethod?: OrderPaymentMethod;
  electronicPaymentMethod?: ElectronicPaymentMethod;
  useWallet?: boolean;
  /** An optional CAP on the wallet amount the customer wants to use. The server still decides the real amount. */
  walletAmountMinor?: number;
  couponCode?: string;
  /** A verified quote whose frozen delivery breakdown is honoured while the inputs it was made for are unchanged. */
  frozen?: { inputsHash: string; breakdown: DeliveryFeeBreakdown } | null;
  /** QUOTE: read-only, no row locks, address problems are reported. ORDER: under the cart lock, problems throw. */
  mode: 'QUOTE' | 'ORDER';
  multiVendorEnabled: boolean;
}

export interface VendorEligibility {
  vendorBranchId: string;
  deliverable: boolean;
  code?: string;
}

export interface AddressEligibility {
  serviceable: boolean;
  code?: string;
  message?: string;
  serviceAreaId: string | null;
  vendors: VendorEligibility[];
}

export interface EtaEstimate {
  available: boolean;
  /** Why no estimate exists — never a fabricated number. */
  reason?: string;
  preparationMinutes: number | null;
  travelMinutes: number | null;
  totalMinutes: number | null;
}

export interface CheckoutSegmentPlan {
  groupIndex: number;
  group: CartVendorGroup;
  groupView: CartGroupView;
  branch: VendorBranch | null;
  /** Flash-sale discounts of this segment's items + its segment-level (subtotal/coupon) discount. */
  discountMinor: number;
  preparationMinutes: number | null;
  couponApplied: boolean;
}

export interface CouponOutcome {
  status: 'NONE' | 'APPLIED' | 'REJECTED';
  code?: string;
  offerId?: string;
  offerName?: string;
  vendorBranchId?: string;
  groupIndex?: number;
  discountMinor?: number;
  reasonCode?: string;
  message?: string;
}

export interface CheckoutPlan {
  cart: Cart;
  view: CartView;
  branchById: Map<string, VendorBranch>;
  fulfillmentType: FulfillmentType;
  hasPendingAdHocPricing: boolean;
  hasWeightedItem: boolean;
  address: DeliveryAddressSnapshot | null;
  eligibility: AddressEligibility | null;
  delivery: {
    applicable: boolean;
    feeMinor: number | null;
    /** Registered-vendor breakdown, or the Hatly-Service charge for ad-hoc orders. */
    breakdown: unknown | null;
    source: 'NONE' | 'FRESH' | 'FROZEN_QUOTE';
    adHocLocations: {
      pickupLatitude: number | null;
      pickupLongitude: number | null;
      destinationLatitude: number | null;
      destinationLongitude: number | null;
    } | null;
  };
  segments: CheckoutSegmentPlan[];
  offerPlans: Map<string, OfferItemPlan>;
  subtotalPlansByGroupIndex: Map<number, OfferSegmentPlan>;
  coupon: CouponOutcome;
  subtotalMinor: number;
  discountMinor: number;
  deliveryFeeMinor: number | null;
  totalMinor: number | null;
  payment: {
    method: OrderPaymentMethod | null;
    electronicMethod: ElectronicPaymentMethod | null;
    walletBalanceMinor: number;
    walletAppliedMinor: number;
    amountDueMinor: number | null;
    /** MANUAL_TRANSFER: fulfilment stays blocked until an admin approves the payment. */
    awaitsPaymentApproval: boolean;
  };
  eta: EtaEstimate;
  /** Fingerprint of every input a quote depends on (cart lines + prices, fulfilment, vendors, location, coupon). */
  inputsHash: string;
  /** Problems that stop an order being placed but that a quote can still describe. */
  blockers: Array<{ code: string; message: string; details?: unknown }>;
}
