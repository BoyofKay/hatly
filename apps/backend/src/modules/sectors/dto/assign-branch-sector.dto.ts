import { IsUUID } from 'class-validator';

export class AssignBranchSectorDto {
  @IsUUID()
  marketplaceSectorId: string;
}
