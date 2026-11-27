import { IsString, MaxLength, MinLength } from 'class-validator';

export class CreateUploadDto {
  // Ceiling on the encoded string (5 MiB of image ≈ 6.99 M base64 chars) so an oversized body is refused by validation before any
  // decoding. The decoded-size check in image-validation.ts is the authoritative one.
  @IsString()
  @MinLength(1)
  @MaxLength(7_000_000)
  base64Content: string;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  filename: string;
}

/** Voice note upload (2026-11-27): ≤ 4 MB of audio → ≤ ~5.6 M base64 characters. */
export class CreateAudioUploadDto {
  @IsString()
  @MinLength(1)
  @MaxLength(6_000_000)
  base64Content: string;
}
