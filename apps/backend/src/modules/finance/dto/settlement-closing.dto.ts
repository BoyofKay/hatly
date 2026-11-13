import { IsISO8601, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

/** Body of a courier / vendor close. `previewToken` (from the preview) makes the close refuse if what is eligible changed since then. */
export class CloseCourierDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  previewToken?: string;
}

export class CloseVendorDto extends CloseCourierDto {
  /** A Cairo date (YYYY-MM-DD, up to the end of that day) or an ISO instant. Omitted: up to now. Never later than now. */
  @IsOptional()
  @IsISO8601()
  periodEnd?: string;
}

export class StatementRangeQuery {
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  from?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  to?: string;
}

export class VendorPreviewQuery {
  @IsOptional()
  @IsISO8601()
  periodEnd?: string;
}
