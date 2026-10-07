import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Channel } from '@prisma/client';
import axios, { AxiosInstance } from 'axios';
import {
  ChannelError,
  IChannelAdapter,
  ParsedWebhookEvent,
  SendMessageResult,
  WebhookVerifyResult,
} from '../channel-adapter.interface';
import {
  TgApiResponse,
  TgInlineKeyboardButton,
  TgMessage,
  TelegramEventType,
  TgUpdate,
  chatIdToString,
  telegramEventId,
} from './telegram.types';

/** Ответ answerCallbackQuery. */
interface EmptyResult {
  ok: boolean;
}

/**
 * Адаптер Telegram: отправка сообщений через Bot API (axios),
 * проверка секретного заголовка и разбор webhook-update.
 */
@Injectable()
export class TelegramAdapter implements IChannelAdapter {
  private readonly logger = new Logger(TelegramAdapter.name);
  private readonly http: AxiosInstance;
  private readonly webhookSecret: string;

  constructor(configService: ConfigService) {
    const token = configService.getOrThrow<string>('TELEGRAM_BOT_TOKEN');
    this.webhookSecret = configService.getOrThrow<string>('TELEGRAM_WEBHOOK_SECRET');
    this.http = axios.create({
      baseURL: `https://api.telegram.org/bot${token}`,
      timeout: 15_000,
    });
  }

  /** Сверка заголовка X-Telegram-Bot-Api-Secret-Token (постоянное сравнение). */
  verifyWebhook(secretHeader: string | undefined): WebhookVerifyResult {
    if (!secretHeader) return { ok: false };
    // timingSafeEqual против timing-атак; длины выравниваем через hash
    const crypto = require('crypto') as typeof import('crypto');
    const a = crypto.createHash('sha256').update(this.webhookSecret).digest();
    const b = crypto.createHash('sha256').update(secretHeader).digest();
    return { ok: crypto.timingSafeEqual(a, b) };
  }

  /** Разбор update в дискриминированное событие. Payload с ПДн не логируем. */
  parseWebhook(body: unknown): ParsedWebhookEvent {
    const update = body as TgUpdate;
    const eventId = telegramEventId(update.update_id);
    const event = this.toDomainEvent(update);
    return { eventId, channel: Channel.TELEGRAM, payload: event };
  }

  /** Маппинг update -> доменное событие. */
  private toDomainEvent(update: TgUpdate): TelegramEventType {
    const msg: TgMessage | undefined = update.message ?? update.edited_message ?? update.channel_post;

    if (update.message?.text?.startsWith('/start')) {
      const chat = update.message.chat;
      return { type: 'start', chatId: chatIdToString(chat.id), username: chat.username };
    }
    if (msg?.text?.startsWith('/stop')) {
      return { type: 'stop', chatId: chatIdToString(msg.chat.id) };
    }
    if (update.callback_query) {
      const cq = update.callback_query;
      const chatId = chatIdToString(cq.message?.chat.id ?? cq.from.id);
      if (cq.data === 'consent:yes') {
        return { type: 'consent_yes', chatId, callbackQueryId: cq.id };
      }
      if (cq.data === 'consent:stop') {
        return { type: 'consent_stop', chatId, callbackQueryId: cq.id };
      }
      return { type: 'ignored', chatId };
    }
    if (update.my_chat_member) {
      const mcm = update.my_chat_member;
      const blocked = mcm.new_chat_member.status === 'kicked';
      return { type: 'my_chat_member', chatId: chatIdToString(mcm.chat.id), blocked };
    }
    // Прочие события: логируем только тип и id, без payload
    this.logger.log(`Пропущено событие: update_id=${update.update_id}, тип=${this.detectKind(update)}`);
    return { type: 'ignored' };
  }

  private detectKind(update: TgUpdate): string {
    if (update.message) return 'message';
    if (update.edited_message) return 'edited_message';
    if (update.channel_post) return 'channel_post';
    if (update.callback_query) return 'callback_query';
    if (update.my_chat_member) return 'my_chat_member';
    return 'unknown';
  }

  /** Отправка текстового сообщения в чат. Ошибки нормализуются в ChannelError. */
  async sendMessage(channelUserId: string, content: string): Promise<SendMessageResult> {
    try {
      const res = await this.http.post<TgApiResponse<TgMessage>>('/sendMessage', {
        chat_id: channelUserId,
        text: content,
      });
      const data = res.data;
      if (!data.ok || !data.result) {
        throw new ChannelError(data.description ?? 'sendMessage failed', 'UNKNOWN');
      }
      return { externalId: String(data.result.message_id) };
    } catch (err) {
      throw this.normalizeError(err);
    }
  }

  /** Отправка сообщения с inline-кнопками (для consent-сообщения). */
  async sendMessageWithKeyboard(
    channelUserId: string,
    content: string,
    buttons: TgInlineKeyboardButton[][],
  ): Promise<SendMessageResult> {
    try {
      const res = await this.http.post<TgApiResponse<TgMessage>>('/sendMessage', {
        chat_id: channelUserId,
        text: content,
        reply_markup: { inline_keyboard: buttons },
      });
      const data = res.data;
      if (!data.ok || !data.result) {
        throw new ChannelError(data.description ?? 'sendMessage failed', 'UNKNOWN');
      }
      return { externalId: String(data.result.message_id) };
    } catch (err) {
      throw this.normalizeError(err);
    }
  }

  /** Ответ на callback_query (убирает «часики» у пользователя). */
  async answerCallbackQuery(callbackQueryId: string): Promise<void> {
    try {
      await this.http.post<TgApiResponse<EmptyResult>>('/answerCallbackQuery', {
        callback_query_id: callbackQueryId,
      });
    } catch (err) {
      // Не критично для бизнес-логики — только лог
      this.logger.warn(`answerCallbackQuery failed: ${this.describe(err)}`);
    }
  }

  /** Нормализация ошибок axios/Telegram в ChannelError с кодами для воркера. */
  private normalizeError(err: unknown): ChannelError {
    if (err instanceof ChannelError) return err;

    const axiosErr = err as { response?: { status?: number; data?: TgApiResponse<unknown> }; message?: string };
    const status = axiosErr?.response?.status;
    const tg = axiosErr?.response?.data as TgApiResponse<unknown> | undefined;

    // 429 Too Many Requests -> RATE_LIMITED с retry_after
    if (status === 429) {
      const retryAfterSec = tg?.parameters?.retry_after ?? 1;
      return new ChannelError(
        tg?.description ?? 'rate limited',
        'RATE_LIMITED',
        retryAfterSec * 1000,
      );
    }
    // 403 Forbidden (бот заблокирован пользователем) -> BLOCKED
    if (status === 403) {
      return new ChannelError(tg?.description ?? 'forbidden: bot was blocked by the user', 'BLOCKED');
    }
    if (status && status >= 500) {
      return new ChannelError(tg?.description ?? `server error ${status}`, 'RETRYABLE');
    }
    return new ChannelError(this.describe(err), 'UNKNOWN');
  }

  private describe(err: unknown): string {
    const axiosErr = err as { message?: string; code?: string };
    return axiosErr?.message ?? String(err);
  }
}
