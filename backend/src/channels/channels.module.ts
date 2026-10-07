import { Module } from '@nestjs/common';
import { MaxModule } from './max/max.module';
import { TelegramModule } from './telegram/telegram.module';

/**
 * Агрегирующий модуль каналов. Ядро приложения зависит только
 * от IChannelAdapter и не знает о специфике конкретных мессенджеров.
 */
@Module({
  imports: [TelegramModule, MaxModule],
})
export class ChannelsModule {}
