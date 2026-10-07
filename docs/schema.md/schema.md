
# СХЕМА БАЗЫ ДАННЫХ (backend/prisma/schema.prisma)

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum Channel {
  TELEGRAM
  MAX
  WHATSAPP
}

enum MessageDirection {
  INBOUND
  OUTBOUND
}

enum MessageKind {
  SERVICE
  MARKETING
}

enum MessageStatus {
  QUEUED
  SENT
  DELIVERED
  FAILED
  SKIPPED_NO_CONSENT
}

enum CampaignStatus {
  DRAFT
  SCHEDULED
  RUNNING
  PAUSED
  COMPLETED
}

enum CampaignContactStatus {
  PENDING
  SENT
  FAILED
  SKIPPED
}

model Contact {
  id        String   @id @default(uuid())
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  name  String?
  email String?
  city  String?
  tags  String[]

  // Telegram
  telegramChatId         String?   @unique
  telegramConsentAt      DateTime?
  telegramConsentSource  String?   // например "bot_button"
  telegramConsentVersion String?   // версия текста согласия
  telegramUnsubscribedAt DateTime?
  telegramBlockedAt      DateTime?

  // MAX
  maxUserId         String?   @unique
  maxConsentAt      DateTime?
  maxConsentSource  String?
  maxConsentVersion String?
  maxUnsubscribedAt DateTime?
  maxBlockedAt      DateTime?

  // WhatsApp (Фаза 2)
  whatsappPhone         String?   @unique
  whatsappConsentAt     DateTime?
  whatsappConsentSource String?
  whatsappConsentVersion String?
  whatsappUnsubscribedAt DateTime?

  messages  Message[]
  campaigns CampaignContact[]

  @@index([email])
}

model Message {
  id        String   @id @default(uuid())
  createdAt DateTime @default(now())

  contactId String
  contact   Contact @relation(fields: [contactId], references: [id])

  channel   Channel
  direction MessageDirection
  kind      MessageKind      @default(SERVICE)
  content   String           @db.Text
  status    MessageStatus    @default(QUEUED)
  attempts  Int              @default(0)
  lastError String?          @db.Text

  campaignId String?
  campaign   Campaign? @relation(fields: [campaignId], references: [id])

  externalId String? // id сообщения в канале
  sentAt     DateTime?

  @@unique([channel, externalId])
  @@index([contactId])
  @@index([campaignId])
  @@index([status])
}

model Campaign {
  id        String   @id @default(uuid())
  createdAt DateTime @default(now())

  name            String
  channel         Channel
  kind            MessageKind    @default(MARKETING)
  status          CampaignStatus @default(DRAFT)
  templateContent String         @db.Text
  scheduledAt     DateTime?
  startedAt       DateTime?
  completedAt     DateTime?

  contacts CampaignContact[]
  messages Message[]
}

model CampaignContact {
  campaignId String
  campaign   Campaign @relation(fields: [campaignId], references: [id])
  contactId  String
  contact    Contact  @relation(fields: [contactId], references: [id])

  status CampaignContactStatus @default(PENDING)
  sentAt DateTime?

  @@id([campaignId, contactId])
}

model ProcessedEvent {
  eventId     String   @id
  channel     Channel
  processedAt DateTime @default(now())
}

model ErrorLog {
  id           String   @id @default(uuid())
  createdAt    DateTime @default(now())
  channel      Channel
  errorType    String
  errorMessage String   @db.Text
  stackTrace   String?  @db.Text
  context      Json?    // без персональных данных
}
```


# DOCKER COMPOSE (docker-compose.yml, только для локальной разработки)

Пароли ниже — только для локальной среды, в проде не использовать. Ключ version не указывать (устарел).

```yaml
services:
  postgres:
    image: postgres:16-alpine
    container_name: mvp-postgres
    environment:
      POSTGRES_USER: mvp_user
      POSTGRES_PASSWORD: mvp_password
      POSTGRES_DB: mvp_db
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U mvp_user -d mvp_db"]
      interval: 5s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    container_name: mvp-redis
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 5s
      retries: 5

volumes:
  postgres_data:
  redis_data:
```

Туннель (ngrok / Cloudflare Tunnel) в compose не включать, запускается вручную: ngrok http 3000.

