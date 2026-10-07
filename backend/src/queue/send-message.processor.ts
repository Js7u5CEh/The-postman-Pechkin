import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, UnrecoverableError } from 'bullmq';
import { Channel, MessageStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ConsentService } from '../consent/consent.service';
import { ChannelError } from '../channels/channel-adapter.interface';
import { TelegramAdapter } from '../channels/telegram/telegram.adapter';
import { MaxAdapter } from '../channels/max/max.adapter';
import { extractChannelUserId } from './queue.service';
import { SEND_MESSAGE_QUEUE } from './queue.constants';

/** Полезная нагрузка job очереди: только UUID записи Message (не chat id!). */
interface SendMessageJobData {
  messageId: string;
}

/**
 * Воркер отправки сообщений (@Processor из @nestjs/bullmq).
 * Непосредственно перед отправкой повторно проверяет согласие (условия (a)-(d)).
 * Обработка ошибок канала: 429 -> retry_after; 403 -> blockedAt без ретраев; прочие -> exponential backoff.
 */
@Processor(SEND_MESSAGE_QUEUE)
@Injectable()
export class SendMessageProcessor extends WorkerHost {
  private readonly logger = new Logger(SendMessageProcessor.name);
  /** Числовой код бота (без секрета) — для диагностики «молчащего» воркера. */
  private readonly botId: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly consent: ConsentService,
    configService: ConfigService,
    @Optional() private readonly telegram: TelegramAdapter,
    @Optional() private readonly max: MaxAdapter,
  ) {
    super();
    const token = configService.getOrThrow<string>('TELEGRAM_BOT_TOKEN');
    // Логируем только числовой префикс токена — секреты не логируем.
    this.botId = token.split(':')[0] ?? '?';
  }

  /** Старт воркера вместе с приложением: видно в логах, что он слушает очередь. */
  onModuleInit(): void {
    this.logger.log(
      `Воркер запущен: слушаю очередь "${SEND_MESSAGE_QUEUE}" (бот ${this.botId})`,
    );
  }

  /** Обработчик job'ов очереди send-message (WorkerHost из @nestjs/bullmq). */
  async process(job: Job<SendMessageJobData>): Promise<void> {
    const { messageId } = job.data;
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      include: { contact: true },
    });

    if (!message) {
      this.logger.warn(`Message ${messageId} не найдена — job удалён`);
      return;
    }
    // Повторная постановка / уже отправленное — ничего не делаем.
    if (message.status !== 'QUEUED') {
      this.logger.log(`Message ${messageId} status=${message.status}, пропуск`);
      return;
    }

    // ---- Повторная consent-проверка непосредственно перед отправкой ----
    if (message.kind === 'MARKETING') {
      const check = this.consent.check(message.contact, message.channel);
      if (!check.allowed) {
        await this.prisma.message.update({
          where: { id: messageId },
          data: {
            status: MessageStatus.SKIPPED_NO_CONSENT,
            lastError: check.reason,
          },
        });
        this.logger.log(`MARKETING ${messageId} пропущен в воркере: ${check.reason}`);
        return;
      }
    }

    const chatId = extractChannelUserId(message.contact, message.channel);
    if (!chatId) {
      await this.markFailed(messageId, 'нет ID канала для отправки', job);
      return;
    }

    // ---- Отправка через адаптер канала ----
    try {
      const adapter = this.adapterFor(message.channel);
      const result = await adapter.sendMessage(chatId, message.content);

      await this.prisma.message.update({
        where: { id: messageId },
        data: {
          status: MessageStatus.SENT,
          externalId: result.externalId,
          sentAt: new Date(),
          attempts: job.attemptsMade + 1,
        },
      });
      this.logger.log(`Message ${messageId} отправлена (externalId=${result.externalId})`);
    } catch (err) {
      await this.handleSendError(job, messageId, message.channel, err);
    }
  }

  /** Выбор адаптера по каналу. */
  private adapterFor(channel: Channel) {
    switch (channel) {
      case 'TELEGRAM':
        return this.telegram;
      case 'MAX':
        return this.max;
      default:
        throw new ChannelError(`Канал ${channel} не поддерживается`, 'UNKNOWN');
    }
  }

  /** Единая обработка ошибок отправки: 429 / 403 / прочие. */
  private async handleSendError(
    job: Job<SendMessageJobData>,
    messageId: string,
    channel: Channel,
    err: unknown,
  ): Promise<void> {
    const attemptsLeft = (job.opts.attempts ?? 1) - (job.attemptsMade + 1);

    if (err instanceof ChannelError) {
      // 429: rate limit -> пауза по retry_after, затем повтор
      if (err.code === 'RATE_LIMITED') {
        const retryAfterMs = err.retryAfterMs ?? 1000;
        await this.prisma.message.update({
          where: { id: messageId },
          data: {
            attempts: job.attemptsMade + 1,
            lastError: `429 rate limited, retry_after=${retryAfterMs}ms`,
          },
        });
        await job.moveToDelayed(Date.now() + retryAfterMs, job.token);
        this.logger.warn(`Message ${messageId}: 429, повтор через ${retryAfterMs}ms`);
        return;
      }

      // 403: бот заблокирован -> blockedAt, без ретраев
      if (err.code === 'BLOCKED') {
        const message = await this.prisma.message.findUnique({
          where: { id: messageId },
          include: { contact: true },
        });
        if (message) {
          await this.prisma.$transaction([
            this.prisma.contact.update({
              where: { id: message.contactId },
              data: blockFieldFor(channel),
            }),
            this.prisma.message.update({
              where: { id: messageId },
              data: {
                status: MessageStatus.FAILED,
                attempts: job.attemptsMade + 1,
                lastError: err.message,
              },
            }),
          ]);
        }
        await this.logError(channel, 'BLOCKED', err.message, messageId);
        // Больше не ретраим: UnrecoverableError прекращает все попытки.
        throw new UnrecoverableError(err.message);
      }

      await this.logError(channel, err.code, err.message, messageId);
    }

    // Прочие ошибки: exponential backoff через штатный retry BullMQ
    await this.prisma.message.update({
      where: { id: messageId },
      data: {
        attempts: job.attemptsMade + 1,
        lastError: err instanceof Error ? err.message : String(err),
      },
    });

    if (attemptsLeft <= 0) {
      await this.prisma.message.update({
        where: { id: messageId },
        data: { status: MessageStatus.FAILED },
      });
      this.logger.error(`Message ${messageId}: попытки исчерпаны`);
      return;
    }

    // Бросаем ошибку -> BullMQ сделает exponential backoff (delay: 2000 * 2^n)
    throw err instanceof Error ? err : new Error(String(err));
  }

  /** Финальная пометка FAILED. */
  private async markFailed(messageId: string, reason: string, _job: Job<SendMessageJobData>): Promise<void> {
    await this.prisma.message.update({
      where: { id: messageId },
      data: { status: MessageStatus.FAILED, lastError: reason },
    });
  }

  /** Запись в ErrorLog без персональных данных. */
  private async logError(
    channel: Channel,
    errorType: string,
    errorMessage: string,
    messageId?: string,
  ): Promise<void> {
    try {
      await this.prisma.errorLog.create({
        data: {
          channel,
          errorType,
          errorMessage: errorMessage.slice(0, 500),
          context: messageId ? { messageId } : undefined,
        },
      });
    } catch (logErr) {
      this.logger.warn(`Не удалось записать ErrorLog: ${String(logErr)}`);
    }
  }
}

/** Поле blockedAt для канала. */
function blockFieldFor(channel: Channel): Record<string, Date> {
  switch (channel) {
    case 'TELEGRAM':
      return { telegramBlockedAt: new Date() };
    case 'MAX':
      return { maxBlockedAt: new Date() };
    default:
      return {};
  }
}
