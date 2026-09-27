import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HatlyServicePricingConfig } from './entities/hatly-service-pricing-config.entity';

/**
 * Manages the single current ad-hoc "Hatly Service" pricing config
 * row. See the entity's own doc comment — `config`'s contents are
 * never interpreted here, only stored/retrieved. `isActive` defaults
 * to false (see the entity) — this scaffold does not activate any
 * pricing behavior on its own; something has to explicitly turn it on
 * once a real formula exists to apply.
 */
@Injectable()
export class HatlyServicePricingService {
  constructor(
    @InjectRepository(HatlyServicePricingConfig)
    private readonly repo: Repository<HatlyServicePricingConfig>,
  ) {}

  async getCurrent(): Promise<HatlyServicePricingConfig | null> {
    const rows = await this.repo.find({ order: { createdAt: 'DESC' }, take: 1 });
    return rows[0] ?? null;
  }

  async upsert(
    config: unknown,
    updatedByUserId: string,
    isActive?: boolean,
  ): Promise<HatlyServicePricingConfig> {
    let row = await this.getCurrent();
    if (!row) {
      row = this.repo.create({});
    }
    row.config = config;
    row.updatedByUserId = updatedByUserId;
    if (isActive !== undefined) {
      row.isActive = isActive;
    }
    return this.repo.save(row);
  }
}
