import { IsBoolean } from 'class-validator';

export class SetAutoAcceptDto {
  @IsBoolean()
  autoAcceptEnabled: boolean;
}
