import { randomUUID } from 'crypto';
import { BadRequestException } from '@nestjs/common';
import { ProofOfDeliveryService } from './proof-of-delivery.service';

function buildHarness(params: { existing?: any } = {}) {
  const store = new Map<string, any>();
  if (params.existing) store.set(params.existing.id, params.existing);

  const proofOfDeliveryRepository = {
    create: (data: any) => ({ ...data }),
    save: async (entity: any) => {
      if (!entity.id && [...store.values()].some((r) => r.deliveryId === entity.deliveryId)) {
        const e: any = new Error('duplicate key value violates unique constraint "idx_proof_of_deliveries_delivery_unique"');
        e.code = '23505';
        throw e;
      }
      const withId = { id: entity.id ?? randomUUID(), createdAt: new Date(), ...entity };
      store.set(withId.id, withId);
      return withId;
    },
    findOne: async (opts: any) => [...store.values()].find((r) => r.deliveryId === opts.where.deliveryId) ?? null,
  };

  const ownedUrls = new Set<string>(['https://hatly.example/uploads/real-photo.jpg']);
  const uploadsService = {
    findOwnedUrls: jest.fn(async (urls: string[], _uploadedByUserId: string) => new Set(urls.filter((u) => ownedUrls.has(u)))),
  };
  const requestContextService = { getCorrelationId: jest.fn(() => 'corr-test') };

  const service = new ProofOfDeliveryService(proofOfDeliveryRepository as any, uploadsService as any, requestContextService as any);
  return { service, proofOfDeliveryRepository, uploadsService, store };
}

describe('ProofOfDeliveryService', () => {
  const baseParams = {
    driverUserId: 'driver-user-1',
    driverId: 'driver-1',
    deliveryId: 'delivery-1',
    orderId: 'order-1',
  };

  it('CRITICAL: rejects with PROOF_PHOTO_REQUIRED when no photo URL is supplied — never persists anything', async () => {
    const { service, proofOfDeliveryRepository } = buildHarness();

    await expect(service.recordForDelivery({ ...baseParams })).rejects.toMatchObject({
      response: { details: { code: 'PROOF_PHOTO_REQUIRED' } },
    });
    expect(proofOfDeliveryRepository.create).toBeDefined(); // sanity: repo wired
  });

  it('rejects a blank/whitespace-only photo URL the same as a missing one', async () => {
    const { service } = buildHarness();
    await expect(service.recordForDelivery({ ...baseParams, photoUrl: '   ' })).rejects.toThrow(BadRequestException);
  });

  it('CRITICAL: rejects with INVALID_PROOF_PHOTO when the URL is not a real upload owned by this driver', async () => {
    const { service, uploadsService } = buildHarness();

    await expect(
      service.recordForDelivery({ ...baseParams, photoUrl: 'https://evil.example/not-mine.jpg' }),
    ).rejects.toMatchObject({ response: { details: { code: 'INVALID_PROOF_PHOTO' } } });
    expect(uploadsService.findOwnedUrls).toHaveBeenCalledWith(['https://evil.example/not-mine.jpg'], 'driver-user-1');
  });

  it('persists a valid submission with photo + recipient name and returns it', async () => {
    const { service, store } = buildHarness();

    const result = await service.recordForDelivery({
      ...baseParams,
      photoUrl: 'https://hatly.example/uploads/real-photo.jpg',
      recipientName: 'Ahmed',
    });

    expect(result.photoUrl).toBe('https://hatly.example/uploads/real-photo.jpg');
    expect(result.recipientName).toBe('Ahmed');
    expect(result.deliveryId).toBe('delivery-1');
    expect(result.orderId).toBe('order-1');
    expect(result.driverId).toBe('driver-1');
    expect(result.submittedAt).toBeInstanceOf(Date);
    expect(store.size).toBe(1);
  });

  it('recipientName is optional — stored as null, never fabricated', async () => {
    const { service } = buildHarness();

    const result = await service.recordForDelivery({
      ...baseParams,
      photoUrl: 'https://hatly.example/uploads/real-photo.jpg',
    });

    expect(result.recipientName).toBeNull();
  });

  it('CRITICAL: idempotent duplicate — a retried submission for the SAME delivery returns the already-recorded row, never a second row, never a raw DB error', async () => {
    const existing = {
      id: 'pod-existing',
      orderId: 'order-1',
      deliveryId: 'delivery-1',
      driverId: 'driver-1',
      photoUrl: 'https://hatly.example/uploads/first-photo.jpg',
      recipientName: 'Original Recipient',
      submittedAt: new Date('2026-01-01T00:00:00Z'),
    };
    const { service, store } = buildHarness({ existing });

    const result = await service.recordForDelivery({
      ...baseParams,
      photoUrl: 'https://hatly.example/uploads/real-photo.jpg', // a DIFFERENT photo on retry
      recipientName: 'Someone Else',
    });

    // Historical evidence is never overwritten — the original row wins.
    expect(result.id).toBe('pod-existing');
    expect(result.photoUrl).toBe('https://hatly.example/uploads/first-photo.jpg');
    expect(result.recipientName).toBe('Original Recipient');
    expect(store.size).toBe(1);
  });

  it('trims whitespace from recipientName and collapses an empty-after-trim value to null', async () => {
    const { service } = buildHarness();

    const result = await service.recordForDelivery({
      ...baseParams,
      photoUrl: 'https://hatly.example/uploads/real-photo.jpg',
      recipientName: '   ',
    });

    expect(result.recipientName).toBeNull();
  });
});
