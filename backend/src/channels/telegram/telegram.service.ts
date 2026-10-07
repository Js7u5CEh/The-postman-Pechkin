import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Channel, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ConsentService } from '../../consent/consent.service';
import { QueueService } from '../../queue/queue.service';
import { TelegramAdapter } from './telegram.adapter';
import {
  CONSENT_MESSAGE_TEXT,
  stoppedText,
} from './telegram.texts';
import { TelegramEventType } from './telegram.types';

/** Что handler собрал внутри транзакции: id сообщений и callback-запросов. */
interface HandlerOutcome {
  messageIds: string[];
  callbackQueryIds: string[];
}

const EMPTY_OUTCOME: HandlerOutcome = { messageIds: [], callbackQueryIds: [] };

/**
 * Бизнес-обработка Telegram-событий.
 * Все записи БД выполняются в одной транзакции Prisma.
 * Идемпотентность: сначала processedEvent.create, дубль ловим по P2002.
 * Внешние вызовы (очередь, answerCallbackQuery) — только после коммита.
 */
@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly consent: ConsentService,
    private readonly queue: QueueService,
    private readonly adapter: TelegramAdapter,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Обработка события в транзакции.
   * Возвращает 'duplicate' при P2002 (событие уже обработано ранее).
   */
  async handleEvent(
    event: TelegramEventType,
    eventId: string,
  ): Promise<'processed' | 'duplicate'> {
    let outcome: HandlerOutcome;
    try {
      outcome = await this.prisma.$transaction(async (tx) => {
        // Идемпотентность: запись о событии и бизнес-логика в одной транзакции.
        // Откат транзакции => событие не считается обработанным, Telegram повторит.
        await tx.processedEvent.create({
          data: { eventId, channel: Channel.TELEGRAM },
        });

        switch (event.type) {
          case 'start':
            return this.handleStart(tx, event);
          case 'stop':
            return this.handleStop(tx, event.chatId);
          case 'consent_yes':
            return this.handleConsentYes(tx, event.chatId, event.callbackQueryId);
          case 'consent_stop':
            return this.handleConsentStop(tx, event.chatId, event.callbackQueryId);
          case 'my_chat_member':
            return this.handleMyChatMember(tx, event.chatId, event.blocked);
          case 'ignored':
            return EMPTY_OUTCOME;
        }
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        // Дубль: событие с таким update_id уже обработано
        this.logger.log(`Дубликат события ${eventId}, пропускаем`);
        return 'duplicate';
      }
      throw err;
    }

    // Транзакция закоммичена: ставим сообщения в очередь и отвечаем на callback.
    for (const messageId of outcome.messageIds) {
      await this.queue.enqueueMessage(messageId);
    }
    for (const callbackQueryId of outcome.callbackQueryIds) {
      await this.adapter.answerCallbackQuery(callbackQueryId);
    }
    return 'processed';
  }

  /** /start: контакт БЕЗ согласия + SERVICE-сообщение с текстом согласия и кнопкой. */
  private async handleStart(
    tx: Prisma.TransactionClient,
    event: Extract<TelegramEventType, { type: 'start' }>,
  ): Promise<HandlerOutcome> {
    // /start сам по себе НЕ является согласием на рекламу.
    const contact = await tx.contact.upsert({
      where: { telegramChatId: event.chatId },
      create: { telegramChatId: event.chatId, tags: [] },
      // Уже зафиксированное согласие при повторном /start не трогаем.
      update: {},
    });

    const message = await tx.message.create({
      data: {
        contactId: contact.id,
        channel: Channel.TELEGRAM,
        direction: 'OUTBOUND',
        kind: 'SERVICE',
        content: CONSENT_MESSAGE_TEXT,
        status: 'QUEUED',
      },
    });
    return { messageIds: [message.id], callbackQueryIds: [] };
  }

  /** /stop: мгновенная отписка + подтверждение (SERVICE). */
  private async handleStop(
    tx: Prisma.TransactionClient,
    chatId: string,
  ): Promise<HandlerOutcome> {
    const contact = await tx.contact.upsert({
      where: { telegramChatId: chatId },
      create: {
        telegramChatId: chatId,
        tags: [],
        telegramUnsubscribedAt: new Date(),
      },
      update: { telegramUnsubscribedAt: new Date() },
    });

    const message = await tx.message.create({
      data: {
        contactId: contact.id,
        channel: Channel.TELEGRAM,
        direction: 'OUTBOUND',
        kind: 'SERVICE',
        content: stoppedText(),
        status: 'QUEUED',
      },
    });
    return { messageIds: [message.id], callbackQueryIds: [] };
  }

  /** consent:yes — согласие фиксируется ТОЛЬКО по нажатию кнопки. */
  private async handleConsentYes(
    tx: Prisma.TransactionClient,
    chatId: string,
    callbackQueryId: string,
  ): Promise<HandlerOutcome> {
    await tx.contact.updateMany({
      where: { telegramChatId: chatId },
      data: {
        telegramConsentAt: new Date(),
        telegramConsentSource: 'bot_button',
        telegramConsentVersion:
          this.configService.getOrThrow<string>('CONSENT_TEXT_VERSION'),
        telegramUnsubscribedAt: null, // сброс отписки
      },
    });
    return { messageIds: [], callbackQueryIds: [callbackQueryId] };
  }

  /** consent:stop — отписка по кнопке. */
  private async handleConsentStop(
    tx: Prisma.TransactionClient,
    chatId: string,
    callbackQueryId: string,
  ): Promise<HandlerOutcome> {
    await tx.contact.updateMany({
      where: { telegramChatId: chatId },
      data: { telegramUnsubscribedAt: new Date() },
    });
    return { messageIds: [], callbackQueryIds: [callbackQueryId] };
  }

  /** my_chat_member: kicked -> blockedAt, member -> сброс. */
  private async handleMyChatMember(
    tx: Prisma.TransactionClient,
    chatId: string,
    blocked: boolean,
  ): Promise<HandlerOutcome> {
    await tx.contact.updateMany({
      where: { telegramChatId: chatId },
      data: { telegramBlockedAt: blocked ? new Date() : null },
    });
    return EMPTY_OUTCOME;
  }
}
