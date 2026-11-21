import { BadRequestException } from '@nestjs/common';

/**
 * Staff (dashboard) password rule: at least 10 characters with at least one letter and one digit. Stricter than the customer rule
 * (8 characters) because a staff account can act on every order, store and customer.
 */
export function assertStrongStaffPassword(password: string): void {
  if (typeof password !== 'string' || password.length < 10 || password.length > 128 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    throw new BadRequestException({
      message: 'The password must be 10–128 characters and contain at least one letter and one digit.',
      details: { code: 'WEAK_PASSWORD' },
    });
  }
}
