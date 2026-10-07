import { Channel } from '@prisma/client';

/** Результат отправки сообщения в канал. */
export interface SendMessageResult {
  /** id сообщения в канале (Telegram message_id и т.п.). */
  externalId: string;
}

/** Ошибки канала с кодом для логики ретраев воркера. */
export class ChannelError extends Error {
  constructor(
    message: string,
    public readonly code: 'RATE_LIMITED' | 'BLOCKED' | 'RETRYABLE' | 'UNKNOWN',
    /** Telegram: parameters.retry_after (мс). */
    public readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'ChannelError';
  }
}

/** Результат проверки секрета webhook. */
export type WebhookVerifyResult = { ok: true } | { ok: false };

/** Нормализованное входящее событие канала. */
export interface ParsedWebhookEvent {
  eventId: string; // например tg_<update_id>
  channel: Channel;
  // Дискриминатор события заполняет конкретный адаптер (см. telegram.adapter.ts)
  payload: unknown;
}

/**
 * Единый интерфейс адаптера канала.
 * Ядро (queue, consent, campaigns) не знает о специфике Telegram/MAX.
 */
export interface IChannelAdapter {
  /** Отправка сообщения по ID чата/пользователя канала. */
  sendMessage(channelUserId: string, content: string): Promise<SendMessageResult>;

  /** Проверка секретного заголовка webhook (X-Telegram-Bot-Api-Secret-Token и т.п.). */
  verifyWebhook(secretHeader: string | undefined): WebhookVerifyResult;

  /** Разбор тела webhook в нормализованное событие. */
  parseWebhook(body: unknown): ParsedWebhookEvent;
}

/** Token канала для уникального ключа per-chat лимитера. */
export function rateKeyFor(channel: Channel, channelUserId: string): string {
  return `rate:chat:${channel}:${channelUserId}`;
}
