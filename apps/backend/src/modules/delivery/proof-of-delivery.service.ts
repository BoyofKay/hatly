import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ProofOfDelivery } from './entities/proof-of-delivery.entity';
import { UploadsService } from '../uploads/uploads.service';
import { RequestContextService } from '../../common/request-context/request-context.service';
import { logBusinessEvent } from '../../common/logging/log-business-event';
import { BusinessEvent } from '../../common/logging/business-events';

/**
 * M4 — Proof of Delivery. Called by DriverOrderActionsService BEFORE
 * the ON_THE_WAY→DELIVERED transition ever runs (see that service's
 * own comment) — CONFIRMED this is what makes POD non-bypassable: a
 * driver cannot reach the DELIVERED state without first passing this
 * validation, since `updateStatus` never calls
 * `orderStateMachine.transition(...)` unless this method resolves
 * successfully first.
 *
 * Not wrapped in the same DB transaction as the state transition
 * itself (touching `OrderStateMachineService`'s own transaction/lock
 * ordering was explicitly out of scope — see driver-order-actions.
 * service.ts's own "thin wrapper, NOT a new state machine" comment).
 * The accepted, narrow edge case: if the transition call that follows
 * this method somehow still fails (e.g. a genuine concurrent-state
 * race), a Proof of Delivery row can exist for a delivery that never
 * actually reached DELIVERED — harmless orphaned evidence, and still
 * satisfies the hard requirement that DELIVERED can never be reached
 * WITHOUT valid, already-persisted POD.
 */
@Injectable()
export class ProofOfDeliveryService {
  private readonly logger = new Logger(ProofOfDeliveryService.name);

  constructor(
    @InjectRepository(ProofOfDelivery)
    private readonly proofOfDeliveryRepository: Repository<ProofOfDelivery>,
    private readonly uploadsService: UploadsService,
    private readonly requestContextService: RequestContextService,
  ) {}

  /**
   * Validates and persists the Proof of Delivery for one delivery.
   * Idempotent by construction: a retried submission for the same
   * `deliveryId` (e.g. a double-tap) returns the ALREADY-recorded row
   * rather than erroring or silently overwriting it with different
   * content — historical evidence, once written, is never replaced.
   */
  async recordForDelivery(params: {
    driverUserId: string;
    driverId: string;
    deliveryId: string;
    orderId: string;
    photoUrl?: string;
    recipientName?: string;
  }): Promise<ProofOfDelivery> {
    const photoUrl = params.photoUrl?.trim();
    if (!photoUrl) {
      throw new BadRequestException({
        message: 'A delivery photo is required before a delivery can be marked as delivered.',
        details: { code: 'PROOF_PHOTO_REQUIRED' },
      });
    }

    // Never trust a client-asserted URL: it must be a real Hatly upload the
    // submitting driver themselves created (same pattern CartService already
    // uses for prescription/custom-item photos — see UploadsService.findOwnedUrls).
    const ownedUrls = await this.uploadsService.findOwnedUrls([photoUrl], params.driverUserId);
    if (!ownedUrls.has(photoUrl)) {
      throw new BadRequestException({
        message: 'The delivery photo must be uploaded via /uploads by this driver first.',
        details: { code: 'INVALID_PROOF_PHOTO' },
      });
    }

    const recipientName = params.recipientName?.trim() || null;

    try {
      const saved = await this.proofOfDeliveryRepository.save(
        this.proofOfDeliveryRepository.create({
          orderId: params.orderId,
          deliveryId: params.deliveryId,
          driverId: params.driverId,
          photoUrl,
          recipientName,
          submittedAt: new Date(),
        }),
      );
      logBusinessEvent(this.logger, 'log', BusinessEvent.PROOF_OF_DELIVERY_SUBMITTED, () => this.requestContextService.getCorrelationId(), {
        proofOfDeliveryId: saved.id,
        orderId: params.orderId,
        deliveryId: params.deliveryId,
        driverId: params.driverId,
      });
      return saved;
    } catch (error: any) {
      if (error?.code === '23505') {
        // Already submitted for this delivery — CONFIRMED benign, idempotent:
        // return the existing evidence rather than a raw DB error or a
        // silent overwrite of already-recorded historical evidence.
        const existing = await this.proofOfDeliveryRepository.findOne({ where: { deliveryId: params.deliveryId } });
        if (existing) {
          logBusinessEvent(
            this.logger,
            'warn',
            BusinessEvent.PROOF_OF_DELIVERY_DUPLICATE_SUBMISSION,
            () => this.requestContextService.getCorrelationId(),
            { proofOfDeliveryId: existing.id, orderId: params.orderId, deliveryId: params.deliveryId, driverId: params.driverId },
          );
          return existing;
        }
      }
      throw error;
    }
  }
}
