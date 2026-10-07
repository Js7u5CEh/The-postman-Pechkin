import { Injectable, Logger } from '@nestjs/common';
import { Channel } from '@prisma/client';
import {
  IChannelAdapter,
  ParsedWebhookEvent,
  SendMessageResult,
  WebhookVerifyResult,
} from '../channel-adapter.interface';

/**
 * Заглушка адаптера MAX (Шаги 1-2).
 * Реализация — после проверки доступа к Bot API MAX.
 */
@Injectable()
export class MaxAdapter implements IChannelAdapter {
  private readonly logger = new Logger(MaxAdapter.name);

  async sendMessage(_channelUserId: string, _content: string): Promise<SendMessageResult> {
    // Заглушка: реальная отправка будет добавлена после проверки доступа.
    throw new Error('MAX adapter не реализован (Фаза 1: заглушка)');
  }

  verifyWebhook(_secretHeader: string | undefined): WebhookVerifyResult {
    // Заглушка: секрет MAX будет проверяться после настройки канала.
    this.logger.warn('verifyWebhook[MAX] вызван, но адаптер является заглушкой');
    return { ok: false };
  }

  parseWebhook(body: unknown): ParsedWebhookEvent {
    // Заглушка: структура update MAX будет реализована позже.
    this.logger.warn('parseWebhook[MAX] вызван, но адаптер является заглушкой');
    return { eventId: `max_unsupported_${Date.now()}`, channel: Channel.MAX, payload: body };
  }
}
