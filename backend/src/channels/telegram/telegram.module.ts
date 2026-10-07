import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QueueModule } from '../../queue/queue.module';
import { ConsentModule } from '../../consent/consent.module';
import { SEND_MESSAGE_QUEUE } from '../../queue/queue.constants';
import { TelegramAdapter } from './telegram.adapter';
import { TelegramController } from './telegram.controller';
import { TelegramService } from './telegram.service';

/**
 * Модуль канала Telegram: адаптер, webhook-контроллер, бизнес-обработка.
 * Очередь SEND_MESSAGE_QUEUE ('send-message') регистрируется здесь же —
 * постановка job'ов идёт через QueueService (InjectQueue).
 */
@Module({
  imports: [ConsentModule, QueueModule, BullModule.registerQueue({ name: SEND_MESSAGE_QUEUE })],
  controllers: [TelegramController],
  providers: [TelegramAdapter, TelegramService],
  exports: [TelegramAdapter, TelegramService],
})
export class TelegramModule {}
