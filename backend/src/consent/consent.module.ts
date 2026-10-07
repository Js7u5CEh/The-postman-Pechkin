import { Module } from '@nestjs/common';
import { ConsentService } from './consent.service';

/**
 * Модуль проверки согласий. Импортируется всеми, кто ставит
 * сообщения в очередь или отправляет их (queue, campaigns, telegram).
 */
@Module({
  providers: [ConsentService],
  exports: [ConsentService],
})
export class ConsentModule {}
