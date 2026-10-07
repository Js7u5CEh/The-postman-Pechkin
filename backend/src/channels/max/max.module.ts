import { Module } from '@nestjs/common';
import { MaxAdapter } from './max.adapter';

/**
 * Модуль канала MAX — заглушка на Шаги 1-2.
 */
@Module({
  providers: [MaxAdapter],
  exports: [MaxAdapter],
})
export class MaxModule {}
