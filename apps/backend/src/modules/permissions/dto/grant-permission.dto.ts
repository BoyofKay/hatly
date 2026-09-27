import { IsEnum } from 'class-validator';
import { Permission } from '../permission.enum';

export class GrantPermissionDto {
  @IsEnum(Permission)
  permission: Permission;
}
