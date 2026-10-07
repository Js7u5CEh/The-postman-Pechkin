import { Inject, Module, OnModuleDestroy } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import Redis from 'ioredis';
import { ConsentModule } from '../consent/consent.module';
import { PerChatRateService } from './per-chat-rate.service';
import { QueueService } from './queue.service';
import { REDIS_CLIENT, SEND_MESSAGE_QUEUE } from './queue.constants';

/**
 * Модуль очереди отправки (BullMQ поверх Redis 7).
 * Глобальный лимит Telegram задаётся в QueueService (limiter очереди),
 * per-chat 1 msg/сек — через Redis-слоты (PerChatRateService).
 */
@Module({
  imports: [
    ConsentModule,
    // Общее соединение BullMQ (очередь + воркер)
    BullModule.forRootAsync({
      useFactory: () => ({
        connection: {
          host: process.env.REDIS_HOST ?? 'localhost',
          port: Number(process.env.REDIS_PORT ?? 6379),
        },
      }),
    }),
    // Регистрация очереди; класс с @Processor(SEND_MESSAGE_QUEUE) — воркер.
    // Лимиты (глобальный и per-chat) реализованы слотовым механизмом PerChatRateService.
    BullModule.registerQueue({ name: SEND_MESSAGE_QUEUE }),
  ],
  providers: [
    QueueService,
    PerChatRateService,
    {
      // Отдельный ioredis-клиент для LUA-скриптов per-chat лимитера
      provide: REDIS_CLIENT,
      useFactory: () =>
        new Redis({
          host: process.env.REDIS_HOST ?? 'localhost',
          port: Number(process.env.REDIS_PORT ?? 6379),
          maxRetriesPerRequest: null,
        }),
    },
  ],
  exports: [QueueService, PerChatRateService, REDIS_CLIENT],
})
export class QueueModule implements OnModuleDestroy {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async onModuleDestroy(): Promise<void> {
    await this.redis.quit();
  }
}
