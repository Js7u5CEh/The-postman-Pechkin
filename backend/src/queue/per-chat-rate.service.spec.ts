import { Channel } from '@prisma/client';
import { PerChatRateService } from './per-chat-rate.service';

/** Мок ioredis: реализует логику LUA-скрипта на JS для проверки расчёта слотов. */
function makeRedisMock(intervalMs: number) {
  const zsets = new Map<string, number[]>();
  return {
    eval: async (
      _script: string,
      _numKeys: number,
      key: string,
      now: string,
      interval: string,
      window: string,
    ) => {
      const nowNum = Number(now);
      const intervalNum = Number(interval);
      void window;
      const arr = (zsets.get(key) ?? []).filter((s) => s > nowNum - 60_000);
      const last = arr.length ? Math.max(...arr) : null;
      let next = nowNum;
      if (last !== null && last + intervalNum > nowNum) next = last + intervalNum;
      arr.push(next);
      zsets.set(key, arr);
      return next;
    },
  } as never;
}

describe('PerChatRateService (слоты, мок Redis)', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    process.env = { ...OLD_ENV, TG_PER_CHAT_RATE_PER_SEC: '1', TG_GLOBAL_RATE_PER_SEC: '30' };
  });
  afterAll(() => {
    process.env = OLD_ENV;
  });

  it('первый слот — без задержки', async () => {
    const svc = new PerChatRateService(makeRedisMock(1000));
    const { delayMs } = await svc.reserveChatSlot('rate:chat:TELEGRAM:1', { nowMs: 1_000_000 });
    expect(delayMs).toBe(0);
  });

  it('второй вызов в ту же секунду получает задержку ~1000 мс', async () => {
    const svc = new PerChatRateService(makeRedisMock(1000));
    const t0 = 2_000_000;
    await svc.reserveChatSlot('rate:chat:TELEGRAM:1', { nowMs: t0 });
    const second = await svc.reserveChatSlot('rate:chat:TELEGRAM:1', { nowMs: t0 + 10 });
    expect(second.delayMs).toBeGreaterThanOrEqual(990);
    expect(second.delayMs).toBeLessThanOrEqual(1010);
  });

  it('разные чаты не влияют друг на друга', async () => {
    const svc = new PerChatRateService(makeRedisMock(1000));
    const t0 = 3_000_000;
    await svc.reserveChatSlot('rate:chat:TELEGRAM:1', { nowMs: t0 });
    const other = await svc.reserveChatSlot('rate:chat:TELEGRAM:2', { nowMs: t0 });
    expect(other.delayMs).toBe(0);
  });

  it('слоты монотонны (FIFO)', async () => {
    const svc = new PerChatRateService(makeRedisMock(1000));
    const t0 = 4_000_000;
    const a = await svc.reserveChatSlot('rate:chat:TELEGRAM:7', { nowMs: t0 });
    const b = await svc.reserveChatSlot('rate:chat:TELEGRAM:7', { nowMs: t0 });
    const c = await svc.reserveChatSlot('rate:chat:TELEGRAM:7', { nowMs: t0 });
    expect(a.slotAtMs).toBeLessThan(b.slotAtMs);
    expect(b.slotAtMs).toBeLessThan(c.slotAtMs);
    expect(c.slotAtMs - a.slotAtMs).toBe(2 * 1000);
  });

  it('глобальный слот использует TG_GLOBAL_RATE_PER_SEC (интервал ~33 мс при 30/сек)', async () => {
    const svc = new PerChatRateService(makeRedisMock(33));
    expect(svc.getGlobalIntervalMs()).toBe(33);
    expect(svc.getPerChatIntervalMs()).toBe(1000);
    void Channel.TELEGRAM;
  });
});
