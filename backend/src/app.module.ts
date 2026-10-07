import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from './config/env.validation';
import { PrismaModule } from './prisma/prisma.module';
import { ConsentModule } from './consent/consent.module';
import { QueueModule } from './queue/queue.module';
import { SendMessageModule } from './queue/send-message.module';
import { ChannelsModule } from './channels/channels.module';
import { ContactsModule } from './contacts/contacts.module';
import { CampaignsModule } from './campaigns/campaigns.module';

/**
 * Корневой модуль MVP broadcast service.
 * Приложение не стартует без TELEGRAM_BOT_TOKEN и TELEGRAM_WEBHOOK_SECRET (validateEnv).
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env'],
      validate: validateEnv,
    }),
    PrismaModule,
    ConsentModule,
    QueueModule,
    // Модуль воркера: без него @Processor не стартует и очередь не разбирается
    SendMessageModule,
    ChannelsModule,
    ContactsModule,
    CampaignsModule,
  ],
})
export class AppModule {}
