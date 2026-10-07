import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { IsIn, IsISO8601, IsOptional, IsString, MinLength } from 'class-validator';
import { CampaignsService } from './campaigns.service';

/** DTO создания кампании. */
export class CreateCampaignDto {
  @IsString()
  @MinLength(1)
  name!: string;

  // Канал рассылки: TELEGRAM или MAX (WHATSAPP — Фаза 2)
  @IsIn(['TELEGRAM', 'MAX'])
  channel!: 'TELEGRAM' | 'MAX';

  @IsString()
  @MinLength(1)
  templateContent!: string;

  @IsOptional()
  @IsISO8601()
  scheduledAt?: string;
}

/** REST API кампаний. */
@Controller('campaigns')
export class CampaignsController {
  constructor(private readonly campaigns: CampaignsService) {}

  @Get()
  findAll(
    @Query('limit', new ParseIntPipe({ optional: true })) limit = 50,
    @Query('offset', new ParseIntPipe({ optional: true })) offset = 0,
  ) {
    return this.campaigns.findAll(limit, offset);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.campaigns.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateCampaignDto) {
    return this.campaigns.create({
      name: dto.name,
      channel: dto.channel,
      templateContent: dto.templateContent,
      scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : null,
    });
  }

  @Post(':id/start')
  start(@Param('id', ParseUUIDPipe) id: string) {
    return this.campaigns.start(id);
  }
}
