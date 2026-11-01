import { IsOptional, IsPhoneNumber, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class DashboardLoginDto {
  @IsPhoneNumber()
  phone: string;

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password: string;

  /** The authenticator code (or a recovery code) — only needed once the admin account has an authenticator enabled. */
  @IsOptional()
  @IsString()
  @MaxLength(32)
  mfaCode?: string;
}

export class MfaCodeDto {
  @IsString()
  @MinLength(6)
  @MaxLength(32)
  @Matches(/^[0-9a-fA-F-]+$/, { message: 'code must be digits (or a recovery code)' })
  code: string;
}

export class MfaDisableDto extends MfaCodeDto {
  /** Disabling needs the account password too — a stolen session alone must not be able to remove the second factor. */
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password: string;
}
