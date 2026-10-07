import { Inject, Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';

/**
 * LUA-скрипт: атомарный резерв «слота» отправки.
 *
 * Ключ: rate:chat:{channel}:{chatId} (per-chat) или rate:global:{channel}
 * (глобальный лимит). ZSET, score = время слота, мс.
 * Алгоритм:
 *   1) удаляем устаревшие записи (старше окна);
 *   2) берём последний зарезервированный слот (max score);
 *   3) nextSlot = max(last + intervalMs, now);
 *   4) ZADD nextSlot; возвращаем nextSlot.
 *
 * Гарантия: не более одного слота на интервал. Всё атомарно в Redis.
 * Примечание: в BullMQ 6 OSS queue-level limiter удалён, поэтому и глобальный,
 * и per-chat лимиты реализованы единым слотовым механизмом (см. README risk notes).
 */
const RESERVE_SLOT_LUA = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local interval = tonumber(ARGV[2])
local window = tonumber(ARGV[3])

-- 1) чистим записи старше окна (не даём ZSET расти бесконечно)
redis.call('ZREMRANGEBYSCORE', key, '-inf', now - window)

-- 2) последний занятый слот
local last = redis.call('ZRANGE', key, -1, -1, 'WITHSCORES')
local lastScore = nil
if #last > 0 then lastScore = tonumber(last[2]) end

-- 3) следующий свободный слот
local nextSlot = now
if lastScore ~= nil and lastScore + interval > now then
  nextSlot = lastScore + interval
end

-- 4) резервируем
redis.call('ZADD', key, nextSlot, nextSlot)
-- ключ живёт 2 окна: после этого слоты больше не нужны
redis.call('PEXPIRE', key, window * 2)

return nextSlot
`;

/** Результат резервирования слота. */
export interface SlotReservation {
  /** Абсолютное время (мс), когда можно отправлять. */
  slotAtMs: number;
  /** Задержка для BullMQ job: slotAtMs - now (>= 0). */
  delayMs: number;
}

/** Опции резервирования слота. */
export interface ReserveSlotOptions {
  /** Интервал между слотами (мс). По умолчанию — per-chat из TG_PER_CHAT_RATE_PER_SEC. */
  intervalMs?: number;
  /** Текущее время (мс) — для тестов. */
  nowMs?: number;
}

/**
 * Ограничитель частоты на основе Redis-слотов.
 * Вызывается при ПОСТАНОВКЕ в очередь: job получает delay, поэтому воркер
 * физически не сможет отправить чаще лимита — без остановки всего воркера.
 */
@Injectable()
export class PerChatRateService {
  private readonly logger = new Logger(PerChatRateService.name);
  private readonly perChatIntervalMs: number;
  private readonly globalIntervalMs: number;

  constructor(@Inject('REDIS_CLIENT') private readonly redis: Redis) {
    const perChatPerSec = Number(process.env.TG_PER_CHAT_RATE_PER_SEC ?? 1);
    const globalPerSec = Number(process.env.TG_GLOBAL_RATE_PER_SEC ?? 30);
    // Интервал между слотами: 1000 / rate (мс). При rate=1 -> 1000 мс.
    this.perChatIntervalMs = Math.round(1000 / Math.max(1, perChatPerSec));
    this.globalIntervalMs = Math.round(1000 / Math.max(1, globalPerSec));
  }

  /**
   * Резервирует следующий слот для ключа (чат или глобальный).
   * @param rateKey ключ вида rate:chat:{channel}:{chatId} или rate:global:{channel}
   */
  async reserveSlot(rateKey: string, opts: ReserveSlotOptions = {}): Promise<SlotReservation> {
    const intervalMs = opts.intervalMs ?? this.perChatIntervalMs;
    const nowMs = opts.nowMs ?? Date.now();
    const windowMs = Math.max(intervalMs * 60, 60_000); // окно чистки

    const slotAtMs = (await this.redis.eval(
      RESERVE_SLOT_LUA,
      1,
      rateKey,
      String(nowMs),
      String(intervalMs),
      String(windowMs),
    )) as number;

    const delayMs = Math.max(0, slotAtMs - nowMs);
    if (delayMs > 0) {
      this.logger.debug(`Слот ${rateKey}: задержка ${delayMs} мс (slot@${slotAtMs})`);
    }
    return { slotAtMs, delayMs };
  }

  /** Задержка per-chat слота. */
  reserveChatSlot(rateKey: string, opts: ReserveSlotOptions = {}): Promise<SlotReservation> {
    return this.reserveSlot(rateKey, { intervalMs: this.perChatIntervalMs, ...opts });
  }

  /** Задержка глобального слота канала (ключ rate:global:{channel}). */
  reserveGlobalSlot(channel: string, opts: ReserveSlotOptions = {}): Promise<SlotReservation> {
    return this.reserveSlot(`rate:global:${channel}`, {
      intervalMs: this.globalIntervalMs,
      ...opts,
    });
  }

  /** Интервал per-chat (мс) — для тестов. */
  getPerChatIntervalMs(): number {
    return this.perChatIntervalMs;
  }

  /** Интервал глобального лимита (мс) — для тестов. */
  getGlobalIntervalMs(): number {
    return this.globalIntervalMs;
  }
}
