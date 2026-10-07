import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Channel, MessageKind } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ConsentDeniedError, ConsentService } from '../consent/consent.service';
import { rateKeyFor } from '../channels/channel-adapter.interface';
import { PerChatRateService } from './per-chat-rate.service';
import { SEND_MESSAGE_QUEUE } from './queue.constants';

/** Опции постановки сообщения в очередь. */
export interface EnqueueOptions {
  /** Зарезервировано для кампаний (переопределение ключа rate). */
  rateKeyOverride?: string;
}

/**
 * Сервис постановки исходящих сообщений в BullMQ.
 * Consent-проверка выполняется и ЗДЕСЬ (при постановке), и в воркере (перед отправкой).
 * Per-chat лимит 1 msg/сек — через Redis-слоты: job ставится с delay до свободного слота.
 */
@Injectable()
export class QueueService implements OnModuleDestroy {
  private readonly logger = new Logger(QueueService.name);

  constructor(
    // Очередь зарегистрирована в QueueModule через BullModule.registerQueue
    @InjectQueue(SEND_MESSAGE_QUEUE) private readonly queue: Queue,
    private readonly prisma: PrismaService,
    private readonly consent: ConsentService,
    private readonly perChatRate: PerChatRateService,
  ) {}

  /**
   * Постановка Message в очередь по её UUID.
   * MARKETING: проверка условий (a)-(d) — при отказе message.status = SKIPPED_NO_CONSENT, job НЕ ставится.
   * SERVICE: ставится без consent-проверки (сервисные сообщения разрешены всегда).
   */
  async enqueueMessage(messageId: string, _opts?: EnqueueOptions): Promise<void> {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      include: { contact: true },
    });
    if (!message) {
      this.logger.warn(`enqueueMessage: Message ${messageId} не найдена`);
      return;
    }
    if (message.status !== 'QUEUED') {
      this.logger.log(`Message ${messageId} уже обработана (status=${message.status}), пропуск`);
      return;
    }

    // ---- Consent-проверка ДО постановки в очередь ----
    if (message.kind === MessageKind.MARKETING) {
      try {
        this.consent.assertMarketingAllowed(message.contact, message.channel);
      } catch (err) {
        if (err instanceof ConsentDeniedError) {
          await this.prisma.message.update({
            where: { id: messageId },
            data: { status: 'SKIPPED_NO_CONSENT', lastError: err.message },
          });
          this.logger.log(
            `MARKETING ${messageId} пропущен: ${err.message} (contact=${message.contactId})`,
          );
          return; // job не создаём
        }
        throw err;
      }
    }

    // ---- Per-chat rate: резерв слота -> delay ----
    const chatId = extractChannelUserId(message.contact, message.channel);
    if (!chatId) {
      this.logger.warn(`Message ${messageId}: нет ID канала, не ставим в очередь`);
      return;
    }
    const rateKey = rateKeyFor(message.channel, chatId);
    // Per-chat лимит: слот 1/rate msg/сек на чат.
    const chat = await this.perChatRate.reserveChatSlot(rateKey);
    // Глобальный лимит канала: слот TG_GLOBAL_RATE_PER_SEC msg/сек.
    const glob = await this.perChatRate.reserveGlobalSlot(message.channel);
    // Job ждёт обоих слотов.
    const delayMs = Math.max(chat.delayMs, glob.delayMs);

    await this.queue.add(
      'send',
      { messageId },
      {
        jobId: messageId, // идемпотентность постановки: UUID записи Message
        delay: delayMs,
        attempts: 5,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: 1000,
        removeOnFail: false,
      },
    );
    this.logger.log(
      `Message ${messageId} поставлена в очередь (kind=${message.kind}, delay=${delayMs}ms)`,
    );
  }

  /** Плавное закрытие (очередь закрывается BullModule-ом). */
  async onModuleDestroy(): Promise<void> {
    // BullModule управляет жизненным циклом очереди; здесь ничего не закрываем.
  }
}

/** ID чата/пользователя канала из контакта (для ключа rate и отправки). */
export function extractChannelUserId(
  contact: {
    telegramChatId: string | null;
    maxUserId: string | null;
    whatsappPhone: string | null;
  },
  channel: Channel,
): string | null {
  switch (channel) {
    case Channel.TELEGRAM:
      return contact.telegramChatId;
    case Channel.MAX:
      return contact.maxUserId;
    case Channel.WHATSAPP:
      return contact.whatsappPhone;
    default:
      return null;
  }
}
