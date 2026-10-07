import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiForbiddenResponse,
  ApiConflictResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Proposal } from '../generated/prisma/client.js';
import { CurrentActor, SessionGuard } from '../auth/session.guard.js';
import { availableActions } from '../proposals/domain/workflow.js';
import type { Actor } from '../proposals/domain/workflow.js';
import { ProposalsService } from '../proposals/proposals.service.js';
import { WordFeedService } from '../words/word-feed.service.js';
import { WordOfTheDay } from '../words/word-of-the-day.js';
import {
  ApproveDto,
  HistoryEntry,
  ListQuery,
  RejectDto,
  ReviewProposal,
  ScheduleDto,
  VersionedDto,
} from './review.dto.js';

type UserActor = Actor & { kind: 'user' };

/**
 * Back-office endpoints. Signing in is enough to reach them; what each role
 * may actually do is decided by the workflow and reported in `actions`.
 */
@ApiTags('review')
@ApiUnauthorizedResponse({ description: 'UNAUTHENTICATED' })
@ApiForbiddenResponse({ description: 'FORBIDDEN_TRANSITION or SELF_REVIEW' })
@ApiConflictResponse({
  description: 'INVALID_TRANSITION, CONCURRENT_UPDATE or DATE_ALREADY_TAKEN',
})
@UseGuards(SessionGuard)
@Controller('proposals')
export class ReviewController {
  constructor(
    private readonly proposals: ProposalsService,
    private readonly feed: WordFeedService,
  ) {}

  private view(proposal: Proposal, actor: UserActor): ReviewProposal {
    return ReviewProposal.from(proposal, availableActions(proposal, actor));
  }

  @Get()
  @ApiOperation({ summary: 'List proposals, optionally by status' })
  @ApiOkResponse({ type: ReviewProposal, isArray: true })
  async list(
    @Query() query: ListQuery,
    @CurrentActor() actor: UserActor,
  ): Promise<ReviewProposal[]> {
    const proposals = await this.proposals.list(query.status);
    return proposals.map((proposal) => this.view(proposal, actor));
  }

  @Delete()
  @ApiOperation({
    summary: 'Delete every proposal and its history (admin, before a demo)',
  })
  @ApiOkResponse({ schema: { properties: { deleted: { type: 'number' } } } })
  async resetAll(
    @CurrentActor() actor: UserActor,
  ): Promise<{ deleted: number }> {
    const deleted = await this.proposals.resetAll(actor);
    // Every open tornado falls back to the default word.
    this.feed.publish(WordOfTheDay.from(null));
    return { deleted };
  }

  @Get(':id/history')
  @ApiOperation({ summary: 'Audit trail of a proposal' })
  @ApiOkResponse({ type: HistoryEntry, isArray: true })
  async history(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<HistoryEntry[]> {
    return (await this.proposals.history(id)).map((event) =>
      HistoryEntry.from(event),
    );
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Approve a submitted word (reviewer or admin, not your own)',
  })
  @ApiOkResponse({ type: ReviewProposal })
  async approve(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ApproveDto,
    @CurrentActor() actor: UserActor,
  ): Promise<ReviewProposal> {
    return this.view(
      await this.proposals.approve(id, actor, body.version, body.comment),
      actor,
    );
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reject a submitted word with a reason' })
  @ApiOkResponse({ type: ReviewProposal })
  async reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: RejectDto,
    @CurrentActor() actor: UserActor,
  ): Promise<ReviewProposal> {
    return this.view(
      await this.proposals.reject(id, actor, body.version, body.reason),
      actor,
    );
  }

  @Post(':id/schedule')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Schedule an approved word on a day (admin)' })
  @ApiOkResponse({ type: ReviewProposal })
  async schedule(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ScheduleDto,
    @CurrentActor() actor: UserActor,
  ): Promise<ReviewProposal> {
    return this.view(
      await this.proposals.schedule(id, actor, body.version, body.day),
      actor,
    );
  }

  @Post(':id/unschedule')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Free the day of a scheduled word (admin)' })
  @ApiOkResponse({ type: ReviewProposal })
  async unschedule(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: VersionedDto,
    @CurrentActor() actor: UserActor,
  ): Promise<ReviewProposal> {
    return this.view(
      await this.proposals.unschedule(id, actor, body.version),
      actor,
    );
  }

  @Post(':id/publish-now')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Publish an approved word immediately, for live demos (admin)',
  })
  @ApiOkResponse({ type: ReviewProposal })
  async publishNow(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: VersionedDto,
    @CurrentActor() actor: UserActor,
  ): Promise<ReviewProposal> {
    const published = await this.proposals.publishNow(id, actor, body.version);
    // Every open tornado switches to the new word right away.
    this.feed.publish(WordOfTheDay.from(published));
    return this.view(published, actor);
  }
}
