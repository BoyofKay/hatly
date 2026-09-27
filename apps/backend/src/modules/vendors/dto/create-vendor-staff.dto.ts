import { IsEnum, IsOptional, IsPhoneNumber, IsString, IsUUID, MinLength } from 'class-validator';
import { Role } from '../../../common/enums/role.enum';

/** PHASE I-B, CHUNK 9: `password` is required — a Vendor Staff account must always have credentials usable at the real phone+password login, matching the Driver convention exactly (same min length). */
export class CreateVendorStaffDto {
  @IsPhoneNumber()
  phone: string;

  @IsString()
  @MinLength(1)
  fullName: string;

  @IsUUID()
  vendorBranchId: string;

  @IsString()
  @MinLength(8)
  password: string;

  /**
   * Defaults to VENDOR — VENDOR_MANAGER can be requested explicitly.
   * No behavioral difference exists yet between the two roles anywhere
   * in the codebase (confirmed by inspection); accepting the choice
   * here doesn't invent one, it just doesn't block a distinction from
   * being added later.
   */
  @IsOptional()
  @IsEnum([Role.VENDOR, Role.VENDOR_MANAGER])
  role?: Role.VENDOR | Role.VENDOR_MANAGER;
}
