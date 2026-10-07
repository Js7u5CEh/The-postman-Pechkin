import 'reflect-metadata';
import { validateEnv } from './env.validation';

const validEnv = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  REDIS_HOST: 'localhost',
  REDIS_PORT: '6379',
  TELEGRAM_BOT_TOKEN: '123456:ABCDEF',
  TELEGRAM_WEBHOOK_SECRET: 'secret-value-1',
  CONSENT_TEXT_VERSION: 'v1',
  TG_GLOBAL_RATE_PER_SEC: '30',
  TG_PER_CHAT_RATE_PER_SEC: '1',
};

describe('validateEnv', () => {
  it('принимает корректный конфиг', () => {
    expect(() => validateEnv(validEnv)).not.toThrow();
  });

  it('падает без TELEGRAM_BOT_TOKEN', () => {
    const env: Record<string, string | undefined> = { ...validEnv };
    delete env.TELEGRAM_BOT_TOKEN;
    expect(() => validateEnv(env)).toThrow(/TELEGRAM_BOT_TOKEN/);
  });

  it('падает без TELEGRAM_WEBHOOK_SECRET', () => {
    const env: Record<string, string | undefined> = { ...validEnv };
    delete env.TELEGRAM_WEBHOOK_SECRET;
    expect(() => validateEnv(env)).toThrow(/TELEGRAM_WEBHOOK_SECRET/);
  });

  it('падает с секретом в недопустимыми символами', () => {
    expect(() =>
      validateEnv({ ...validEnv, TELEGRAM_WEBHOOK_SECRET: 'плохой секрет!' }),
    ).toThrow(/TELEGRAM_WEBHOOK_SECRET/);
  });
});
