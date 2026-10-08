import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  MessageEvent,
  Sse,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { concat, defer, finalize, interval, map, merge } from 'rxjs';
import type { Observable } from 'rxjs';
import { ProposalsService } from '../proposals/proposals.service.js';
import { WordFeedService } from './word-feed.service.js';
import { WordOfTheDay } from './word-of-the-day.js';

/** Keeps idle connections open through proxies that drop silent streams. */
const HEARTBEAT_MS = 25_000;
/** Simultaneous live connections served by this instance. */
export const MAX_STREAMS = 500;

@ApiTags('words')
@Controller('words')
export class WordsController {
  constructor(
    private readonly proposals: ProposalsService,
    private readonly feed: WordFeedService,
  ) {}

  @Get('current')
  @ApiOperation({ summary: 'Word currently shown by the tornado' })
  @ApiOkResponse({ type: WordOfTheDay })
  async current(): Promise<WordOfTheDay> {
    return WordOfTheDay.from(await this.proposals.current());
  }

  /**
   * Server-Sent Events: the current word right away, then every change.
   * One-way and auto-reconnecting in the browser, which is all a page needs.
   */
  @Sse('stream')
  @SkipThrottle()
  @ApiOperation({
    summary:
      'Live feed of the word of the day (Server-Sent Events, event "word")',
  })
  stream(): Observable<MessageEvent> {
    if (!this.feed.acquireStream(MAX_STREAMS)) {
      // EventSource retries on its own, so the page recovers once load drops.
      throw new HttpException(
        { code: 'TOO_MANY_STREAMS', message: 'Live feed is full, retry later' },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    const initial = defer(() => this.current());
    const words = concat(initial, this.feed.updates).pipe(
      map((data): MessageEvent => ({ type: 'word', data })),
    );
    const heartbeat = interval(HEARTBEAT_MS).pipe(
      map((): MessageEvent => ({ type: 'ping', data: '' })),
    );
    // Runs when the client disconnects, freeing the slot.
    return merge(words, heartbeat).pipe(
      finalize(() => this.feed.releaseStream()),
    );
  }
}
