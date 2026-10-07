import { Module } from '@nestjs/common';
import { Clock, SystemClock } from '../common/clock.js';
import { ProposalsController } from './proposals.controller.js';
import { ProposalsService } from './proposals.service.js';

@Module({
  controllers: [ProposalsController],
  providers: [ProposalsService, { provide: Clock, useClass: SystemClock }],
  exports: [ProposalsService, Clock],
})
export class ProposalsModule {}
