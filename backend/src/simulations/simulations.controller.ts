import {
  Body,
  Controller,
  Param,
  ParseIntPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import type { AuthenticatedAccount } from '../auth/authenticated-account.interface';
import { CurrentAccount } from '../auth/current-account.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { FastSimDto } from './dto/fast-sim.dto';
import { QuickSimDto } from './dto/quick-sim.dto';
import {
  FastSimResponseDto,
  QuickSimResponseDto,
} from './dto/simulation-response.dto';
import { SimulationsService } from './simulations.service';

@Controller('careers/:careerId/simulations')
@UseGuards(JwtAuthGuard)
export class SimulationsController {
  constructor(private readonly simulationsService: SimulationsService) {}

  @Post('quick')
  quickSim(
    @CurrentAccount() account: AuthenticatedAccount,
    @Param('careerId', ParseIntPipe) careerId: number,
    @Body() dto: QuickSimDto,
  ): Promise<QuickSimResponseDto> {
    return this.simulationsService.quickSim(account.id, careerId, dto);
  }

  @Post('fast')
  fastSim(
    @CurrentAccount() account: AuthenticatedAccount,
    @Param('careerId', ParseIntPipe) careerId: number,
    @Body() dto: FastSimDto,
  ): Promise<FastSimResponseDto> {
    return this.simulationsService.fastSim(account.id, careerId, dto);
  }
}
