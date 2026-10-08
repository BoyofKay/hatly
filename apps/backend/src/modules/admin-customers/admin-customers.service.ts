import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { Role } from '../../common/enums/role.enum';
import { AddressesService } from '../addresses/addresses.service';
import { WalletService } from '../wallet/wallet.service';
import { AdminOrdersService, AdminOrderListItemView } from '../orders/admin-orders.service';
import { isUuid } from '../orders/order-number';
import { SearchAdminCustomersQueryDto } from './dto/search-admin-customers-query.dto';

// M3c (Launch-Readiness Gap Audit, G-10). Same contract as
// SearchAdminOrdersQueryDto/CustomerOrdersService.listForCustomer.
const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

/** Never passwordHash (select: false on the entity itself — see User's own doc comment), never any other auth/security field. */
export interface AdminCustomerListItemView {
  id: string;
  fullName: string;
  phone: string;
  isActive: boolean;
  isPhoneVerified: boolean;
  createdAt: Date;
}

export interface AdminCustomerSearchResult {
  data: AdminCustomerListItemView[];
  page: number;
  limit: number;
  total: number;
}

export interface AdminCustomerAddressSummary {
  id: string;
  label: string | null;
  line1: string;
  governorate: string | null;
  city: string | null;
  isDefault: boolean;
}

export interface AdminCustomerDetailView extends AdminCustomerListItemView {
  walletBalanceMinor: number;
  address: AdminCustomerAddressSummary | null;
  orderCount: number;
  recentOrders: AdminOrderListItemView[];
}

/**
 * M3c (Launch-Readiness Gap Audit, G-10) — Admin Customer Management.
 * Read-only. Reuses `AddressesService.listForCustomer`, `WalletService.
 * getBalance`, and `AdminOrdersService.search` for the detail view's
 * address/wallet/order data rather than duplicating any of those
 * queries — this service's OWN query logic is only ever the `users`
 * table lookup itself (list/search + the base customer row).
 */
@Injectable()
export class AdminCustomersService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly addressesService: AddressesService,
    private readonly walletService: WalletService,
    private readonly adminOrdersService: AdminOrdersService,
  ) {}

  async search(query: SearchAdminCustomersQueryDto): Promise<AdminCustomerSearchResult> {
    const page = query.page && query.page > 0 ? query.page : DEFAULT_PAGE;
    const limit = query.limit && query.limit > 0 ? Math.min(query.limit, MAX_LIMIT) : DEFAULT_LIMIT;

    const qb = this.dataSource
      .getRepository(User)
      .createQueryBuilder('u')
      .where('u.role = :role', { role: Role.CUSTOMER }) // never drivers/vendor staff/admins — customer management only
      .orderBy('u.createdAt', 'DESC') // entity property name — see AdminOrdersService.search's own comment on why
      .addOrderBy('u.id', 'DESC') // deterministic tie-break
      .skip((page - 1) * limit)
      .take(limit);

    if (query.isActive !== undefined) {
      qb.andWhere('u.is_active = :isActive', { isActive: query.isActive });
    }

    const search = query.search?.trim();
    if (search) {
      if (isUuid(search)) {
        qb.andWhere('u.id = :search', { search });
      } else {
        qb.andWhere('(u.phone ILIKE :like OR u.full_name ILIKE :like)', { like: `%${search}%` });
      }
    }

    const [users, total] = await qb.getManyAndCount();

    return {
      data: users.map((u) => this.toListItem(u)),
      page,
      limit,
      total,
    };
  }

  /**
   * Assembles the detail view from FOUR independent, already-existing
   * queries (this user row + address + wallet balance + recent
   * orders) — same "several simple queries, not one mega-join" shape
   * `AdminOrdersService.getOne` already established, not a new pattern.
   */
  async getOne(customerId: string): Promise<AdminCustomerDetailView> {
    const user = await this.dataSource.getRepository(User).findOne({ where: { id: customerId, role: Role.CUSTOMER } });
    if (!user) {
      throw new NotFoundException('Customer not found.');
    }

    const [addresses, walletBalanceMinor, recentOrders] = await Promise.all([
      this.addressesService.listForCustomer(customerId),
      this.walletService.getBalance(customerId),
      this.adminOrdersService.search({ customerId, limit: 5 }),
    ]);

    const defaultAddress = addresses.find((a) => a.isDefault) ?? addresses[0] ?? null;

    return {
      ...this.toListItem(user),
      walletBalanceMinor,
      address: defaultAddress
        ? {
            id: defaultAddress.id,
            label: defaultAddress.label ?? null,
            line1: defaultAddress.line1,
            governorate: defaultAddress.governorate ?? null,
            city: defaultAddress.city ?? null,
            isDefault: defaultAddress.isDefault,
          }
        : null,
      orderCount: recentOrders.total,
      recentOrders: recentOrders.data,
    };
  }

  private toListItem(user: User): AdminCustomerListItemView {
    return {
      id: user.id,
      fullName: user.fullName,
      phone: user.phone,
      isActive: user.isActive,
      isPhoneVerified: user.isPhoneVerified,
      createdAt: (user as any).createdAt,
    };
  }
}
