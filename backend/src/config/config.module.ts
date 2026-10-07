import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from './env.validation';

/**
 * Конфигурация приложения: строгая валидация env.
 * Без TELEGRAM_BOT_TOKEN и TELEGRAM_WEBHOOK_SECRET процесс не стартует.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env'],
      validate: validateEnv,
    }),
  ],
})
export class AppConfigModule {}
