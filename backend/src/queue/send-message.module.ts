import { Module } from '@nestjs/common';
import { ConsentModule } from '../consent/consent.module';
import { MaxModule } from '../channels/max/max.module';
import { TelegramModule } from '../channels/telegram/telegram.module';
import { QueueModule } from './queue.module';
import { SendMessageProcessor } from './send-message.processor';

/**
 * Модуль воркера отправки.
 * Отдельно от QueueModule, чтобы импортировать адаптеры каналов
 * (TelegramModule зависит от QueueModule — цикла нет, т.к. этот модуль никто не импортирует).
 */
@Module({
  imports: [QueueModule, ConsentModule, TelegramModule, MaxModule],
  providers: [SendMessageProcessor],
})
export class SendMessageModule {}
