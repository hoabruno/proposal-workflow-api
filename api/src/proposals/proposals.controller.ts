import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  ProposalReceipt,
  SubmitProposalDto,
} from './dto/submit-proposal.dto.js';
import { ProposalsService } from './proposals.service.js';

/** Anonymous visitors may submit a few words per hour each. */
export const SUBMISSIONS_PER_HOUR = 3;

@ApiTags('proposals')
@Controller('proposals')
export class ProposalsController {
  constructor(private readonly proposals: ProposalsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: SUBMISSIONS_PER_HOUR, ttl: 3_600_000 } })
  @ApiOperation({
    summary: 'Propose a word (anonymous, rate limited per visitor)',
  })
  @ApiCreatedResponse({ type: ProposalReceipt })
  @ApiUnprocessableEntityResponse({
    description: 'INVALID_WORD, with a reason: length, characters or blocked',
  })
  @ApiConflictResponse({ description: 'DUPLICATE_WORD' })
  @ApiTooManyRequestsResponse({ description: 'TOO_MANY_REQUESTS' })
  async submit(@Body() body: SubmitProposalDto): Promise<ProposalReceipt> {
    const proposal = await this.proposals.submit({
      word: body.word,
      proposerName: body.proposerName,
    });
    // The receipt deliberately omits internal fields (version, reviewer, ...).
    return {
      id: proposal.id,
      word: proposal.normalizedWord,
      status: proposal.status,
    };
  }
}
