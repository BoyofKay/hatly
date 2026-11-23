import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

/** Display name only; identity, credentials and phone are immutable here. */
export class UpdateFullNameDto {
  @IsString()
  @MinLength(2)
  @MaxLength(150)
  @Matches(/\S/, { message: 'Name must contain visible characters.' })
  fullName: string;
}
