import { IsBoolean } from 'class-validator';

export class UpdateDriverOnlineStatusDto {
  @IsBoolean()
  isOnline: boolean;
}
