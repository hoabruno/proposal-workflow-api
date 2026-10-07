import { Module } from '@nestjs/common';
import { ProposalsModule } from '../proposals/proposals.module.js';
import { PublicationJob } from './publication.job.js';
import { WordFeedService } from './word-feed.service.js';
import { WordsController } from './words.controller.js';

@Module({
  imports: [ProposalsModule],
  controllers: [WordsController],
  providers: [WordFeedService, PublicationJob],
  exports: [WordFeedService, PublicationJob],
})
export class WordsModule {}
