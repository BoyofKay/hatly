import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { BusinessConfig } from './entities/business-config.entity';
import { BusinessConfigKey } from './business-config-key.enum';
import { SettlementFrequency } from '../finance/settlement-frequency.enum';
import { isPointInEgypt } from '../addresses/address-mode';
import { ELECTRONIC_PAYMENT_METHODS, ElectronicPaymentMethod } from '../payments/electronic-payment-method.enum';

/** A positive decimal factor no larger than 10 (a typo guard, not a business limit), with at most 4 decimal places. */
export function isValidHatlyServiceMultiplier(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 10 && Math.round(value * 10000) === value * 10000;
}

export interface ServiceLocation {
  latitude: number;
  longitude: number;
  label: string;
}

/** Roughly Egypt (the same box the address service uses): a typo guard for a default route location, not a business rule. */
export function isValidServiceLocation(value: unknown): value is ServiceLocation {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.latitude === 'number' &&
    typeof v.longitude === 'number' &&
    Number.isFinite(v.latitude) &&
    Number.isFinite(v.longitude) &&
    isPointInEgypt(v.latitude, v.longitude) &&
    typeof v.label === 'string' &&
    v.label.trim().length > 0 &&
    v.label.trim().length <= 120
  );
}

/** Settings an Admin may CLEAR (back to "not configured") — the route defaults, which must never be invented, only unset. */
const CLEARABLE_KEYS: ReadonlySet<string> = new Set([
  BusinessConfigKey.HATLY_SERVICE_DEFAULT_PICKUP_LOCATION,
  BusinessConfigKey.HATLY_SERVICE_DEFAULT_DESTINATION_LOCATION,
  BusinessConfigKey.WASALLY_SERVICE_DEFAULT_DESTINATION_LOCATION,
]);

/** Keys whose value has a known shape: a write that does not match is refused (400) instead of breaking pricing later. */
/** R16: acknowledgement window bounds and default (minutes). */
export const ACK_WINDOW_MIN_MINUTES = 1;
export const ACK_WINDOW_MAX_MINUTES = 30;
export const ACK_WINDOW_DEFAULT_MINUTES = 5;

/** Reads a stored acknowledgement window; anything missing or outside the bounds falls back to the 5-minute default. */
export function resolveAcknowledgementWindowMinutes(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= ACK_WINDOW_MIN_MINUTES && value <= ACK_WINDOW_MAX_MINUTES
    ? value
    : ACK_WINDOW_DEFAULT_MINUTES;
}

const VALUE_VALIDATORS: Partial<Record<string, { valid: (v: unknown) => boolean; message: string }>> = {
  [BusinessConfigKey.HATLY_SERVICE_DELIVERY_FEE_MULTIPLIER]: {
    valid: isValidHatlyServiceMultiplier,
    message: 'The Hatly Service delivery fee multiplier must be a positive number up to 10 (e.g. 1.5).',
  },
  [BusinessConfigKey.HATLY_SERVICE_DEFAULT_PICKUP_LOCATION]: {
    valid: isValidServiceLocation,
    message: 'HATLY_SERVICE_DEFAULT_PICKUP_LOCATION must be { latitude, longitude, label } inside Egypt with a label of 1-120 characters (use DELETE to clear it).',
  },
  [BusinessConfigKey.HATLY_SERVICE_DEFAULT_DESTINATION_LOCATION]: {
    valid: isValidServiceLocation,
    message: 'HATLY_SERVICE_DEFAULT_DESTINATION_LOCATION must be { latitude, longitude, label } inside Egypt with a label of 1-120 characters (use DELETE to clear it).',
  },
  [BusinessConfigKey.WASALLY_SERVICE_DEFAULT_DESTINATION_LOCATION]: {
    valid: isValidServiceLocation,
    message: 'WASALLY_SERVICE_DEFAULT_DESTINATION_LOCATION must be { latitude, longitude, label } inside Egypt with a label of 1-120 characters (use DELETE to clear it).',
  },
  [BusinessConfigKey.DISPATCH_ACKNOWLEDGEMENT_WINDOW_MINUTES]: {
    valid: (v) => typeof v === 'number' && Number.isInteger(v) && v >= ACK_WINDOW_MIN_MINUTES && v <= ACK_WINDOW_MAX_MINUTES,
    message: `DISPATCH_ACKNOWLEDGEMENT_WINDOW_MINUTES must be a whole number of minutes from ${ACK_WINDOW_MIN_MINUTES} to ${ACK_WINDOW_MAX_MINUTES}.`,
  },
  // Customer phone verification switch: a real boolean only — `0`, `""`, `"false"` or `null` must never be stored and later read
  // by truthiness (which would silently turn OTP off, or fail to).
  [BusinessConfigKey.CUSTOMER_OTP_ENABLED]: {
    valid: (v) => typeof v === 'boolean',
    message: 'CUSTOMER_OTP_ENABLED must be true or false.',
  },
};

@Injectable()
export class BusinessConfigService {
  constructor(
    @InjectRepository(BusinessConfig)
    private readonly repo: Repository<BusinessConfig>,
  ) {}

  /**
   * Code that runs INSIDE a database transaction must pass its `manager` to every read, so the read uses the transaction's own
   * connection. A read through the injected repository checks a second connection out of the pool while the transaction still
   * holds one; with as many concurrent transactions as the pool has connections, every one of them waits for a connection that
   * only another one can free — the pool deadlocks and the API stalls (see test/e2e/76-db-pool-safety.e2e-spec.ts).
   */
  private repoFor(manager?: EntityManager): Repository<BusinessConfig> {
    return manager ? manager.getRepository(BusinessConfig) : this.repo;
  }

  /**
   * Returns the stored value for `key`, or `defaultValue` if the key
   * has never been set. Callers own the type via the generic — this
   * service does not validate that a stored value matches whatever
   * shape the caller expects (there is no schema-per-key concept,
   * per the entity's own design).
   */
  async get<T>(key: string, defaultValue: T, manager?: EntityManager): Promise<T> {
    const row = await this.repoFor(manager).findOne({ where: { key } });
    if (!row) return defaultValue;
    return row.value as T;
  }

  /**
   * Like `get()`, but throws instead of accepting a default — for
   * values that must never be silently invented (e.g. delivery-fee
   * pricing parameters). "Do not invent business pricing values"
   * means there is no sensible default to pass here at all; an unset
   * key must fail loudly, not fall back to 0 or any other number.
   */
  async getRequired<T>(key: string, manager?: EntityManager): Promise<T> {
    const row = await this.repoFor(manager).findOne({ where: { key } });
    if (!row) {
      throw new NotFoundException({
        message: `Required business configuration value "${key}" has not been set.`,
        details: { code: 'BUSINESS_CONFIG_NOT_SET', key },
      });
    }
    return row.value as T;
  }

  async getAll(): Promise<BusinessConfig[]> {
    return this.repo.find({ order: { key: 'ASC' } });
  }

  /**
   * Upsert — create the row if this key has never been set,
   * otherwise overwrite its value/description. Every write records
   * who made it (`updatedByUserId`) for the same audit reason
   * `AdminPermission.grantedByUserId` does — not for authorization,
   * only for the historical record.
   */
  async set(
    key: string,
    value: unknown,
    updatedByUserId: string,
    description?: string,
  ): Promise<BusinessConfig> {
    const validator = VALUE_VALIDATORS[key];
    if (validator && !validator.valid(value)) {
      throw new BadRequestException({ message: validator.message, details: { code: 'INVALID_BUSINESS_CONFIG_VALUE', key } });
    }
    let row = await this.repo.findOne({ where: { key } });
    if (!row) {
      row = this.repo.create({ key });
    }
    row.value = value;
    row.updatedByUserId = updatedByUserId;
    if (description !== undefined) {
      row.description = description;
    }
    return this.repo.save(row);
  }

  /**
   * Clears a clearable setting (a Hatly / Wasally default route location) so it is "not configured" again. Idempotent. Any other key is
   * refused: pricing and operational settings are changed, never removed.
   */
  async unset(key: string): Promise<{ key: string; cleared: boolean }> {
    if (!CLEARABLE_KEYS.has(key)) {
      throw new BadRequestException({ message: `"${key}" cannot be cleared.`, details: { code: 'BUSINESS_CONFIG_NOT_CLEARABLE', key } });
    }
    const result = await this.repo.delete({ key });
    return { key, cleared: (result.affected ?? 0) > 0 };
  }

  /**
   * The confirmed Automatic Dispatch master switch (approved this
   * phase). Defaults to `true` (dispatch operates normally) when
   * unset — an operational bootstrap default, not a business-rule
   * invention: the migration also seeds this key explicitly (see
   * the Phase 2 migration), so in a real deployment this fallback is
   * only ever reached if that seed row is somehow missing.
   *
   * Not yet called by anything — the Dispatch module/engine this
   * gates doesn't exist yet (a later approved phase). This method is
   * the confirmed integration point for when it's built.
   */
  async isAutomaticDispatchEnabled(): Promise<boolean> {
    return this.get<boolean>(BusinessConfigKey.AUTOMATIC_DISPATCH_ENABLED, true);
  }

  /**
   * PHASE 3 STEP 4 addition. Called by OrderCreationService. Default
   * `true` when unset for the same reason as
   * isAutomaticDispatchEnabled() — the migration also seeds this key
   * explicitly, so the fallback is only reached if that seed is
   * somehow missing.
   */
  async isMultiVendorOrdersEnabled(): Promise<boolean> {
    return this.get<boolean>(BusinessConfigKey.MULTI_VENDOR_ORDERS_ENABLED, true);
  }

  /**
   * PHASE 4 addition. Returns null (not a fabricated number) when
   * unset — callers must treat null as "no configured limit exists
   * yet," which DriverRankingService interprets as "exclude bicycles
   * entirely" (fail closed), never as "no limit at all."
   */
  async getMaxBicyclePickupDistanceMeters(): Promise<number | null> {
    return this.get<number | null>(BusinessConfigKey.MAX_BICYCLE_PICKUP_DISTANCE_METERS, null);
  }

  /**
   * Manual Transfer payment addition. `getRequired()` (not `get()`
   * with a default) — deliberately fails closed if unset, same
   * discipline as every other unconfigured money/location parameter.
   */
  async getManualTransferDestination(): Promise<{ label: string; phoneOrAccountNumber: string; accountName?: string }> {
    return this.getRequired(BusinessConfigKey.MANUAL_TRANSFER_DESTINATION);
  }

  /** Electronic payment methods currently offered at checkout (PD-006). Unset → all supported; unknown values are dropped. */
  async getEnabledElectronicPaymentMethods(manager?: EntityManager): Promise<ElectronicPaymentMethod[]> {
    const configured = await this.get<unknown>(BusinessConfigKey.CHECKOUT_ENABLED_ELECTRONIC_METHODS, null, manager);
    if (!Array.isArray(configured)) return [...ELECTRONIC_PAYMENT_METHODS];
    return ELECTRONIC_PAYMENT_METHODS.filter((m) => configured.includes(m));
  }

  /** R16: the driver acknowledgement window in minutes (default 5, bounds 1–30). */
  async getAcknowledgementWindowMinutes(manager?: EntityManager): Promise<number> {
    const repo = manager ? manager.getRepository(BusinessConfig) : this.repo;
    const row = await repo.findOne({ where: { key: BusinessConfigKey.DISPATCH_ACKNOWLEDGEMENT_WINDOW_MINUTES } });
    return resolveAcknowledgementWindowMinutes(row?.value);
  }

  /** How long a checkout quote is honoured, seconds (default 15 minutes). */
  async getCheckoutQuoteTtlSeconds(): Promise<number> {
    const value = await this.get<unknown>(BusinessConfigKey.CHECKOUT_QUOTE_TTL_SECONDS, null);
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 900;
  }

  /** Width of the delivery-ETA range in minutes; null = no configured range (never invented). */
  async getEtaRangeBufferMinutes(): Promise<number | null> {
    const value = await this.get<unknown>(BusinessConfigKey.ETA_RANGE_BUFFER_MINUTES, null);
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : null;
  }

  async getCustomerServiceWhatsappNumber(): Promise<string> {
    return this.getRequired(BusinessConfigKey.CUSTOMER_SERVICE_WHATSAPP_NUMBER);
  }

  /**
   * Customer Support contact. Reads the SAME `CUSTOMER_SERVICE_WHATSAPP_NUMBER` key, but — unlike
   * `getCustomerServiceWhatsappNumber()` (Manual Transfer, fails closed) — it never throws and never depends on
   * MANUAL_TRANSFER_DESTINATION: an unset, blank or non-string value is simply "no support number" (`null`), so the
   * customer app can hide the action instead of showing a broken one. Returns the trimmed value as stored.
   */
  async getCustomerSupportWhatsappNumber(): Promise<string | null> {
    const value = await this.get<unknown>(BusinessConfigKey.CUSTOMER_SERVICE_WHATSAPP_NUMBER, null);
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  /**
   * PD-009. The factor applied to the normal delivery fee of a Hatly Service order. Fails closed (throws) if unset, and refuses
   * a stored value that is not a sensible positive number rather than pricing with it.
   */
  async getHatlyServiceDeliveryFeeMultiplier(manager?: EntityManager): Promise<number> {
    const value = await this.getRequired<unknown>(BusinessConfigKey.HATLY_SERVICE_DELIVERY_FEE_MULTIPLIER, manager);
    if (!isValidHatlyServiceMultiplier(value)) {
      throw new BadRequestException({
        message: 'Hatly Service delivery pricing is misconfigured.',
        details: { code: 'BUSINESS_CONFIG_INVALID', key: BusinessConfigKey.HATLY_SERVICE_DELIVERY_FEE_MULTIPLIER },
      });
    }
    return value;
  }

  /**
   * PD-012. One configured route default, or null when it is unset OR holds an invalid value (an invalid stored value is never used
   * to route a courier; the Dashboard shows it as invalid). Never invents or substitutes a location.
   */
  async getServiceLocation(key: BusinessConfigKey, manager?: EntityManager): Promise<ServiceLocation | null> {
    const value = await this.get<unknown>(key, null, manager);
    if (!isValidServiceLocation(value)) return null;
    return { latitude: value.latitude, longitude: value.longitude, label: value.label.trim() };
  }

  /** The three configured defaults, for the customer app: Hatly origin + destination, Wasally destination (Wasally has no origin default). */
  async getServiceRouteDefaults(manager?: EntityManager): Promise<{
    hatly: { origin: ServiceLocation | null; destination: ServiceLocation | null };
    wasally: { destination: ServiceLocation | null };
  }> {
    const [hatlyOrigin, hatlyDestination, wasallyDestination] = await Promise.all([
      this.getServiceLocation(BusinessConfigKey.HATLY_SERVICE_DEFAULT_PICKUP_LOCATION, manager),
      this.getServiceLocation(BusinessConfigKey.HATLY_SERVICE_DEFAULT_DESTINATION_LOCATION, manager),
      this.getServiceLocation(BusinessConfigKey.WASALLY_SERVICE_DEFAULT_DESTINATION_LOCATION, manager),
    ]);
    return { hatly: { origin: hatlyOrigin, destination: hatlyDestination }, wasally: { destination: wasallyDestination } };
  }

  async getVendorSettlementFrequency(): Promise<SettlementFrequency> {
    return this.getRequired(BusinessConfigKey.VENDOR_SETTLEMENT_FREQUENCY);
  }

  async getDriverSettlementFrequency(): Promise<SettlementFrequency> {
    return this.getRequired(BusinessConfigKey.DRIVER_SETTLEMENT_FREQUENCY);
  }

  /**
   * Customer Authentication Modes (master implementation). Default
   * `true` (OTP mode) when unset, following the exact same pattern as
   * `isAutomaticDispatchEnabled()`
   * above — read fresh from Postgres on every call, no caching, so a
   * Dashboard change takes effect on the very next authentication
   * request with no restart required.
   */
  async isCustomerOtpEnabled(): Promise<boolean> {
    // FAIL SAFE: only an explicit boolean `false` (set by an authorized admin) turns phone verification off. Unset, or any malformed
    // value stored before validation existed, keeps OTP ON.
    return (await this.get<unknown>(BusinessConfigKey.CUSTOMER_OTP_ENABLED, true)) !== false;
  }

  /**
   * Loyalty Earning (Chunk C). Defaults to `1` (1 point per 1 EGP) —
   * the approved V1 value — following the exact same
   * default-when-unset convention as `isAutomaticDispatchEnabled()`
   * above, read fresh on every call, no caching.
   */
  async getLoyaltyPointsPerEgp(): Promise<number> {
    return this.get<number>(BusinessConfigKey.LOYALTY_POINTS_PER_EGP, 1);
  }

  /**
   * Points -> Wallet Conversion (Chunk D). Defaults to `100` (100
   * points = 1 EGP) — the approved V1 value.
   */
  async getLoyaltyWalletConversionPointsPerEgp(): Promise<number> {
    return this.get<number>(BusinessConfigKey.LOYALTY_WALLET_CONVERSION_POINTS_PER_EGP, 100);
  }
}
