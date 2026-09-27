import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../../database/base.entity';
import { Role } from '../../../common/enums/role.enum';

/**
 * Core identity record for every actor in the system (customer, driver,
 * vendor staff, admin). Role-specific data (e.g. vehicle info for
 * drivers, branch assignment for vendor staff) lives in separate
 * profile tables, not on this entity, to avoid a wide/nullable-heavy
 * "god table".
 */
@Entity({ name: 'users' })
export class User extends BaseEntity {
  @Index({ unique: true })
  @Column({ name: 'phone', type: 'varchar', length: 20 })
  phone: string;

  @Column({ name: 'full_name', type: 'varchar', length: 150 })
  fullName: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  email?: string | null;

  @Column({ name: 'password_hash', type: 'varchar', nullable: true, select: false })
  passwordHash?: string | null;

  @Column({ type: 'enum', enum: Role, default: Role.CUSTOMER })
  role: Role;

  @Column({ name: 'is_phone_verified', type: 'boolean', default: false })
  isPhoneVerified: boolean;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @Column({ name: 'preferred_language', type: 'varchar', length: 5, default: 'ar' })
  preferredLanguage: 'ar' | 'en';
}
