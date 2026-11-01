import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** Launch-readiness (store policy): the customer confirms the irreversible deletion with their password. */
export class DeleteAccountDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  password: string;
}
