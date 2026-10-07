import { Module } from '@nestjs/common';
import { QueueModule } from '../queue/queue.module';
import { CampaignsController } from './campaigns.controller';
import { CampaignsService } from './campaigns.service';

/**
 * Модуль кампаний: REST API + запуск рассылок через очередь.
 */
@Module({
  imports: [QueueModule],
  controllers: [CampaignsController],
  providers: [CampaignsService],
  exports: [CampaignsService],
})
export class CampaignsModule {}
