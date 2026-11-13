import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RequiresPermission } from '../permissions/decorators/requires-permission.decorator';
import { Permission } from '../permissions/permission.enum';
import { OperationsBoardService } from './operations-board.service';
import { AdminDispatchService } from './admin-dispatch.service';

/** How many ranked drivers the picker lists ahead of the rest (the ranking is the automatic-dispatch one). */
const RANKED_LIMIT = 50;

/** The Operations board: every live order, most urgent first, with what to do next. Read-only; VIEW_ORDERS (no new permission). */
@ApiTags('admin-operations')
@Controller('admin/operations')
export class AdminOperationsBoardController {
  constructor(
    private readonly board: OperationsBoardService,
    private readonly dispatch: AdminDispatchService,
  ) {}

  @Get('board')
  @RequiresPermission(Permission.VIEW_ORDERS)
  async get() {
    return { data: await this.board.board() };
  }

  /**
   * Stage 2 (smart assignment): the drivers automatic dispatch would pick for this order, in its order, with load / capacity — for the
   * board's driver picker. Read-only (the ranking query itself); assigning stays the existing assign/reassign endpoints and their checks.
   * Same permission as the action it serves.
   */
  @Get('orders/:orderId/driver-ranking')
  @RequiresPermission(Permission.ASSIGN_REASSIGN_ORDERS)
  async ranking(@Param('orderId', ParseUUIDPipe) orderId: string) {
    return { data: { ranked: await this.dispatch.suggestDrivers(orderId, RANKED_LIMIT) } };
  }
}
