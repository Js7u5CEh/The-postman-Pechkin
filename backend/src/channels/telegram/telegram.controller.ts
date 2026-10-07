import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Logger,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { TelegramAdapter } from './telegram.adapter';
import { TelegramService } from './telegram.service';
import { TelegramEventType } from './telegram.types';

/**
 * POST /webhook/telegram.
 * Проверка X-Telegram-Bot-Api-Secret-Token обязательна (401 при несовпадении).
 * Ответ 200 отдаём быстро; обработка события — после ответа (транзакция + очередь).
 */
@Controller('webhook')
export class TelegramController {
  private readonly logger = new Logger(TelegramController.name);

  constructor(
    private readonly adapter: TelegramAdapter,
    private readonly telegramService: TelegramService,
  ) {}

  @Post('telegram')
  @HttpCode(200)
  async handleWebhook(
    @Headers('x-telegram-bot-api-secret-token') secretToken: string | undefined,
    @Body() update: unknown,
  ): Promise<{ ok: true }> {
    // 1) Проверка секрета — до любой обработки. Проверка не закомментирована.
    const verify = this.adapter.verifyWebhook(secretToken);
    if (!verify.ok) {
      throw new UnauthorizedException('Неверный секрет webhook');
    }

    // 2) parseWebhook лёгкий (без сетевых вызовов) — выполняем синхронно,
    //    затем отвечаем 200; транзакция и постановка в очередь идут следом.
    const { eventId, payload } = this.adapter.parseWebhook(update);

    void this.telegramService
      .handleEvent(payload as TelegramEventType, eventId)
      .catch((err: unknown) => {
        // Ошибка обработки не влияет на уже отправленный 200.
        // Транзакция откатилась => событие не зафиксировано, Telegram повторит update.
        this.logger.error(
          `Ошибка обработки события ${eventId}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      });

    return { ok: true };
  }
}
