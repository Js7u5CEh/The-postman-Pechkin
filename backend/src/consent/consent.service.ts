import { Injectable } from '@nestjs/common';
import { Channel, Contact } from '@prisma/client';

/** Результат проверки согласия. */
export interface ConsentCheckResult {
  allowed: boolean;
  /** Причина отказа (для статуса SKIPPED_NO_CONSENT и ErrorLog). */
  reason?: string;
}

/**
 * Единое место проверки условий отправки (a)-(d):
 * (a) есть ID канала;
 * (b) unsubscribedAt IS NULL;
 * (c) consentAt IS NOT NULL;
 * (d) канал не помечен как недоступный (blockedAt IS NULL).
 *
 * Вызывается при постановке в очередь И в воркере непосредственно перед отправкой.
 */
@Injectable()
export class ConsentService {
  /** Проверка всех условий (a)-(d) для конкретного канала. */
  check(contact: Contact, channel: Channel): ConsentCheckResult {
    if (channel === 'TELEGRAM') {
      // (a) есть ID канала
      if (!contact.telegramChatId) {
        return { allowed: false, reason: 'нет telegramChatId' };
      }
      // (c) согласие зафиксировано
      if (!contact.telegramConsentAt) {
        return { allowed: false, reason: 'нет согласия (consentAt IS NULL)' };
      }
      // (b) не отписан
      if (contact.telegramUnsubscribedAt) {
        return { allowed: false, reason: 'отписан (unsubscribedAt задан)' };
      }
      // (d) канал доступен (бот не заблокирован)
      if (contact.telegramBlockedAt) {
        return { allowed: false, reason: 'бот заблокирован (blockedAt задан)' };
      }
      return { allowed: true };
    }

    if (channel === 'MAX') {
      if (!contact.maxUserId) {
        return { allowed: false, reason: 'нет maxUserId' };
      }
      if (!contact.maxConsentAt) {
        return { allowed: false, reason: 'нет согласия (consentAt IS NULL)' };
      }
      if (contact.maxUnsubscribedAt) {
        return { allowed: false, reason: 'отписан (unsubscribedAt задан)' };
      }
      if (contact.maxBlockedAt) {
        return { allowed: false, reason: 'канал недоступен (blockedAt задан)' };
      }
      return { allowed: true };
    }

    // WHATSAPP — Фаза 2, отправка запрещена
    return { allowed: false, reason: 'канал WHATSAPP не поддерживается в Фазе 1' };
  }

  /**
   * Проверка для маркетинговых сообщений.
   * Бросает ConsentDeniedError при нарушении любого условия.
   */
  assertMarketingAllowed(contact: Contact, channel: Channel): void {
    const result = this.check(contact, channel);
    if (!result.allowed) {
      throw new ConsentDeniedError(result.reason ?? 'согласие не подтверждено');
    }
  }
}

/** Ошибка отказа по согласию (используется при постановке в очередь). */
export class ConsentDeniedError extends Error {
  constructor(reason: string) {
    super(`Отправка запрещена: ${reason}`);
    this.name = 'ConsentDeniedError';
  }
}
