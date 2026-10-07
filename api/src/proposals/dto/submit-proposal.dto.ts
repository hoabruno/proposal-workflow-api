import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class SubmitProposalDto {
  /** Shape checks only; the word policy (length, characters, blocklist) lives in the domain. */
  @ApiProperty({
    example: 'carouge',
    description: '2 to 12 letters, digits, "." or "-"',
  })
  @IsString()
  @MaxLength(64)
  word: string;

  @ApiPropertyOptional({
    example: 'Léa',
    description: 'Shown publicly if the word is published',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(40)
  proposerName?: string;
}

export class ProposalReceipt {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'carouge' })
  word: string;

  @ApiProperty({ example: 'SUBMITTED' })
  status: string;
}
