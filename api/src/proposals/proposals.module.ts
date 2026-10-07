import { Module } from '@nestjs/common';
import { Clock, SystemClock } from '../common/clock.js';
import { ProposalsService } from './proposals.service.js';

@Module({
  providers: [ProposalsService, { provide: Clock, useClass: SystemClock }],
  exports: [ProposalsService],
})
export class ProposalsModule {}
