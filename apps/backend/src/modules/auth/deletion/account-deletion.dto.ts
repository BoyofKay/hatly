import { IsIn, IsNotEmpty, IsOptional, IsPhoneNumber, IsString, MaxLength } from 'class-validator';
import {
  ACCOUNT_DELETION_REJECTION_REASONS,
  ACCOUNT_DELETION_VERIFICATION_METHODS,
  AccountDeletionRejectionReason,
  AccountDeletionRequestStatus,
  AccountDeletionVerificationMethod,
} from './account-deletion-request.entity';

/** Public page, self-service: the same proof as signing in. Phone in international form (+20…), exactly as the account stores it. */
export class WebAccountDeletionDto {
  @IsPhoneNumber()
  @MaxLength(20)
  phone: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  password: string;
}

/** Public page, "I can't sign in": the phone number only — nothing else is accepted (forbidNonWhitelisted). */
export class AccountDeletionRequestDto {
  @IsPhoneNumber()
  @MaxLength(20)
  phone: string;
}

export class ListAccountDeletionRequestsQueryDto {
  @IsOptional()
  @IsIn(['PENDING', 'COMPLETED', 'REJECTED'])
  status?: AccountDeletionRequestStatus;
}

export class CompleteAccountDeletionRequestDto {
  @IsIn(ACCOUNT_DELETION_VERIFICATION_METHODS as unknown as string[])
  verificationMethod: AccountDeletionVerificationMethod;
}

export class RejectAccountDeletionRequestDto {
  @IsIn(ACCOUNT_DELETION_REJECTION_REASONS as unknown as string[])
  reason: AccountDeletionRejectionReason;
}
