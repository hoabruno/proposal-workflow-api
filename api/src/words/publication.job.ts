import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { TIME_ZONE } from '../proposals/domain/calendar.js';
import { ProposalsService } from '../proposals/proposals.service.js';
import { WordFeedService } from './word-feed.service.js';
import { WordOfTheDay } from './word-of-the-day.js';

@Injectable()
export class PublicationJob implements OnApplicationBootstrap {
  private readonly logger = new Logger(PublicationJob.name);

  constructor(
    private readonly proposals: ProposalsService,
    private readonly feed: WordFeedService,
  ) {}

  /** Catches up at boot, in case the server was down at midnight. */
  async onApplicationBootstrap(): Promise<void> {
    await this.run();
  }

  /** Thirty seconds past midnight in Geneva, safely inside the new day. */
  @Cron('30 0 0 * * *', {
    name: 'publish-word-of-the-day',
    timeZone: TIME_ZONE,
  })
  async run(): Promise<WordOfTheDay | null> {
    try {
      const current = WordOfTheDay.from(await this.proposals.publishDueWords());
      this.feed.publish(current);
      this.logger.log(`Word of the day: ${current.word ?? '(none)'}`);
      return current;
    } catch (error) {
      // A failed run must not crash the app; the next run (or a restart) catches up.
      this.logger.error(
        'Daily publication failed',
        error instanceof Error ? error.stack : error,
      );
      return null;
    }
  }
}
