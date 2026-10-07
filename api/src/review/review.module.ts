import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { ProposalsModule } from '../proposals/proposals.module.js';
import { WordsModule } from '../words/words.module.js';
import { ReviewController } from './review.controller.js';

@Module({
  imports: [AuthModule, ProposalsModule, WordsModule],
  controllers: [ReviewController],
})
export class ReviewModule {}
