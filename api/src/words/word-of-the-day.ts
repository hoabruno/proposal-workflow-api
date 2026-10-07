import { ApiProperty } from '@nestjs/swagger';
import type { Proposal } from '../generated/prisma/client.js';
import { formatDay } from '../proposals/domain/calendar.js';

/** Public view of the live word: only what the animated page needs. */
export class WordOfTheDay {
  @ApiProperty({
    nullable: true,
    type: String,
    example: 'carouge',
    description: 'Null when nothing is published yet',
  })
  word: string | null;

  @ApiProperty({ nullable: true, type: String, example: 'Léa' })
  proposerName: string | null;

  @ApiProperty({
    nullable: true,
    type: String,
    example: '2026-10-08',
    description: 'Calendar day in Geneva',
  })
  day: string | null;

  static from(proposal: Proposal | null): WordOfTheDay {
    return {
      word: proposal?.normalizedWord ?? null,
      proposerName: proposal?.proposerName ?? null,
      day: proposal?.scheduledFor ? formatDay(proposal.scheduledFor) : null,
    };
  }
}
