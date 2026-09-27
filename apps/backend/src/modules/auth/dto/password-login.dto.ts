import { IsPhoneNumber, IsString } from 'class-validator';

/**
 * PHASE I-B, CHUNK 9. Staff-only login path — VENDOR/VENDOR_MANAGER/
 * ADMIN/SUPER_ADMIN, never CUSTOMER (enforced server-side in
 * AuthService.loginStaffWithPassword, never trusted from a client-
 * supplied role — no `role` field exists on this DTO at all).
 */
export class PasswordLoginDto {
  @IsPhoneNumber()
  phone: string;

  @IsString()
  password: string;
}
