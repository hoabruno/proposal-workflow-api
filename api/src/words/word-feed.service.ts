import { Injectable } from '@nestjs/common';
import { Subject } from 'rxjs';
import type { Observable } from 'rxjs';
import { WordOfTheDay } from './word-of-the-day.js';

/**
 * In-process broadcast of word changes to every open page. A single API
 * instance is enough for this demo; with several, this would sit on Postgres
 * LISTEN/NOTIFY or Redis pub/sub instead.
 */
@Injectable()
export class WordFeedService {
  private readonly changes = new Subject<WordOfTheDay>();
  private lastWord: string | null | undefined;
  private openStreams = 0;

  /**
   * Reserves a slot for one more open stream; false once the cap is reached,
   * so a flood of connections cannot exhaust memory or file descriptors.
   */
  acquireStream(max: number): boolean {
    if (this.openStreams >= max) return false;
    this.openStreams++;
    return true;
  }

  get streamCount(): number {
    return this.openStreams;
  }

  releaseStream(): void {
    this.openStreams = Math.max(0, this.openStreams - 1);
  }

  get updates(): Observable<WordOfTheDay> {
    return this.changes.asObservable();
  }

  /** Broadcasts only real changes, so the daily job can call it unconditionally. */
  publish(next: WordOfTheDay): void {
    if (next.word === this.lastWord) return;
    this.lastWord = next.word;
    this.changes.next(next);
  }
}
