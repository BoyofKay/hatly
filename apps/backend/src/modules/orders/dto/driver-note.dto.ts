import { IsOptional, IsString, MaxLength } from 'class-validator';

export class DriverNoteDto {
  /** Empty or missing clears the note. */
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}
