import { plainToInstance } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Min,
  MinLength,
  ValidationError,
  validateSync,
} from 'class-validator';

/**
 * Строгая валидация переменных окружения.
 * Приложение не стартует без TELEGRAM_BOT_TOKEN и TELEGRAM_WEBHOOK_SECRET.
 */
export class EnvVariables {
  @IsString()
  @Matches(/^postgresql:\/\//, {
    message: 'DATABASE_URL должен быть строкой подключения PostgreSQL',
  })
  DATABASE_URL!: string;

  @IsString()
  REDIS_HOST!: string;

  @IsInt()
  @Min(1)
  REDIS_PORT!: number;

  @IsString()
  @MinLength(10, { message: 'TELEGRAM_BOT_TOKEN обязателен' })
  TELEGRAM_BOT_TOKEN!: string;

  // 1-256 символов: A-Z, a-z, 0-9, _ и - (требование Telegram secret_token)
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{1,256}$/, {
    message:
      'TELEGRAM_WEBHOOK_SECRET обязателен: 1-256 символов A-Z, a-z, 0-9, _ и -',
  })
  TELEGRAM_WEBHOOK_SECRET!: string;

  @IsString()
  @MinLength(1)
  CONSENT_TEXT_VERSION!: string;

  @IsInt()
  @Min(1)
  TG_GLOBAL_RATE_PER_SEC!: number;

  @IsInt()
  @Min(1)
  TG_PER_CHAT_RATE_PER_SEC!: number;

  // MAX — Фаза 1 заглушка, токены опциональны
  @IsOptional()
  @IsString()
  MAX_BOT_TOKEN?: string;

  @IsOptional()
  @IsString()
  MAX_WEBHOOK_SECRET?: string;

  @IsOptional()
  @IsString()
  NGROK_AUTHTOKEN?: string;
}

/** Возвращает провалидированный объект env или бросает ошибку со списком проблем. */
export function validateEnv(config: Record<string, unknown>): EnvVariables {
  const validated = plainToInstance(EnvVariables, config, {
    enableImplicitConversion: true,
  });

  const errors: ValidationError[] = validateSync(validated, {
    skipMissingProperties: false,
  });

  if (errors.length > 0) {
    const details = errors
      .map((e) => Object.values(e.constraints ?? {}).join('; '))
      .join(' | ');
    throw new Error(`Некорректные переменные окружения: ${details}`);
  }
  return validated;
}

/** Числовые лимиты Telegram (для очереди). */
export const TG_RATE_KEYS = ['TG_GLOBAL_RATE_PER_SEC', 'TG_PER_CHAT_RATE_PER_SEC'] as const;
export type TgRateKey = (typeof TG_RATE_KEYS)[number];
