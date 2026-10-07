import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import type { Proposal, ProposalEvent } from '../generated/prisma/client.js';
import { ProposalStatus } from '../generated/prisma/enums.js';
import { formatDay } from '../proposals/domain/calendar.js';
import { TRANSITIONS } from '../proposals/domain/workflow.js';
import type { ProposalAction } from '../proposals/domain/workflow.js';

const ACTIONS = Object.keys(TRANSITIONS) as ProposalAction[];

export class ListQuery {
  @ApiPropertyOptional({ enum: ProposalStatus })
  @IsOptional()
  @IsEnum(ProposalStatus)
  status?: ProposalStatus;
}

/** Every decision quotes the version the reviewer saw (optimistic locking). */
export class VersionedDto {
  @ApiProperty({ example: 0 })
  @IsInt()
  @Min(0)
  version: number;
}

export class ApproveDto extends VersionedDto {
  @ApiPropertyOptional({ example: 'Joli choix' })
  @IsOptional()
  @IsString()
  @MaxLength(280)
  comment?: string;
}

export class RejectDto extends VersionedDto {
  @ApiProperty({ example: 'Hors sujet' })
  @IsString()
  @MaxLength(280)
  reason: string;
}

export class ScheduleDto extends VersionedDto {
  @ApiProperty({
    example: '2026-10-20',
    description: 'Calendar day in Geneva, from tomorrow onwards',
  })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'day must be YYYY-MM-DD' })
  day: string;
}

/** Back-office view of a proposal, with the actions the signed-in user may take now. */
export class ReviewProposal {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() word: string;
  @ApiProperty({ nullable: true, type: String }) proposerName: string | null;
  @ApiProperty({ enum: ProposalStatus }) status: ProposalStatus;
  @ApiProperty() version: number;
  @ApiProperty({ nullable: true, type: String }) rejectionReason: string | null;
  @ApiProperty({ nullable: true, type: String, example: '2026-10-20' })
  scheduledFor: string | null;
  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  publishedAt: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt: string;
  @ApiProperty({ enum: ACTIONS, isArray: true }) actions: ProposalAction[];

  static from(proposal: Proposal, actions: ProposalAction[]): ReviewProposal {
    return {
      id: proposal.id,
      word: proposal.normalizedWord,
      proposerName: proposal.proposerName,
      status: proposal.status,
      version: proposal.version,
      rejectionReason: proposal.rejectionReason,
      scheduledFor: proposal.scheduledFor
        ? formatDay(proposal.scheduledFor)
        : null,
      publishedAt: proposal.publishedAt?.toISOString() ?? null,
      createdAt: proposal.createdAt.toISOString(),
      actions,
    };
  }
}

export class HistoryEntry {
  @ApiProperty({ enum: ProposalStatus, nullable: true })
  fromStatus: ProposalStatus | null;
  @ApiProperty({ enum: ProposalStatus }) toStatus: ProposalStatus;
  @ApiProperty({ nullable: true, type: String }) comment: string | null;
  @ApiProperty({
    nullable: true,
    type: String,
    description: 'Null for visitors and the daily job',
  })
  actorName: string | null;
  @ApiProperty({ format: 'date-time' }) at: string;

  static from(
    event: ProposalEvent & { actor: { displayName: string } | null },
  ): HistoryEntry {
    return {
      fromStatus: event.fromStatus,
      toStatus: event.toStatus,
      comment: event.comment,
      actorName: event.actor?.displayName ?? null,
      at: event.createdAt.toISOString(),
    };
  }
}
