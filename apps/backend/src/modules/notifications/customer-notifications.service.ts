import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CustomerNotification } from './entities/customer-notification.entity';
import { CUSTOMER_NOTIFICATION_FALLBACK_TEXT, CustomerNotificationType } from './customer-notification-events';
import { NOTIFICATIONS_DEFAULT_LIMIT, NOTIFICATIONS_MAX_LIMIT, NOTIFICATIONS_MAX_PAGE } from './dto/list-notifications-query.dto';

export interface CustomerNotificationView {
  id: string;
  type: string;
  orderId: string;
  orderNumber: string;
  /** English fallback text; the app localizes from `type`. */
  title: string;
  body: string;
  isRead: boolean;
  readAt: Date | null;
  createdAt: Date;
}

/**
 * The customer's own notifications. EVERY query is scoped by the authenticated caller's id — a client-supplied customer id is
 * never accepted — and a notification that belongs to someone else is indistinguishable from one that does not exist (404),
 * so ids cannot be probed.
 */
@Injectable()
export class CustomerNotificationsService {
  constructor(@InjectRepository(CustomerNotification) private readonly repo: Repository<CustomerNotification>) {}

  async list(customerId: string, params: { page?: number; limit?: number }) {
    const limit = Math.min(Math.max(params.limit ?? NOTIFICATIONS_DEFAULT_LIMIT, 1), NOTIFICATIONS_MAX_LIMIT);
    const page = Math.min(Math.max(params.page ?? 1, 1), NOTIFICATIONS_MAX_PAGE);
    const [rows, total] = await this.repo.findAndCount({
      where: { customerId },
      order: { createdAt: 'DESC', id: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return { data: rows.map((r) => this.view(r)), page, limit, total, unreadCount: await this.unreadCount(customerId) };
  }

  unreadCount(customerId: string): Promise<number> {
    return this.repo.count({ where: { customerId, isRead: false } });
  }

  /** Idempotent: marking an already-read notification read again changes nothing (readAt keeps its first value). */
  async markRead(customerId: string, id: string): Promise<CustomerNotificationView> {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new NotFoundException({ message: 'Notification not found.', details: { code: 'NOTIFICATION_NOT_FOUND' } });
    await this.repo
      .createQueryBuilder()
      .update(CustomerNotification)
      .set({ isRead: true, readAt: () => 'now()' })
      .where('id = :id AND customer_id = :customerId AND is_read = false', { id, customerId })
      .execute();
    const row = await this.repo.findOne({ where: { id, customerId } });
    if (!row) throw new NotFoundException({ message: 'Notification not found.', details: { code: 'NOTIFICATION_NOT_FOUND' } });
    return this.view(row);
  }

  async markAllRead(customerId: string): Promise<{ updated: number }> {
    const result = await this.repo
      .createQueryBuilder()
      .update(CustomerNotification)
      .set({ isRead: true, readAt: () => 'now()' })
      .where('customer_id = :customerId AND is_read = false', { customerId })
      .execute();
    return { updated: result.affected ?? 0 };
  }

  private view(row: CustomerNotification): CustomerNotificationView {
    const text = CUSTOMER_NOTIFICATION_FALLBACK_TEXT[row.type as CustomerNotificationType] ?? { title: 'Order update', body: 'There is an update on your order.' };
    return {
      id: row.id,
      type: row.type,
      orderId: row.orderId,
      orderNumber: row.orderNumber,
      title: text.title,
      body: text.body,
      isRead: row.isRead,
      readAt: row.readAt,
      createdAt: row.createdAt,
    };
  }
}
