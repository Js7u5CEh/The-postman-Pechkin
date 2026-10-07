<<<<<<< HEAD
# MVP Broadcast Service

Сервис рассылок и автоворонок для работы с собственной базой контактов (Telegram + MAX-заглушка). Разработка в рамках compliance (152-ФЗ, 38-ФЗ): отправка рекламных сообщений только при явном, документированном согласии.

## Стек

- **Backend**: NestJS 11, TypeScript (strict), PostgreSQL 16 + Prisma 6, BullMQ (@nestjs/bullmq) поверх Redis 7, axios, class-validator
- **Frontend**: React 19 + Vite, Tailwind CSS 4, компоненты в стиле shadcn/ui, Zustand, React Hook Form + Zod
- **Инфраструктура**: Docker Compose (postgres:16-alpine, redis:7-alpine), туннель для вебхуков — отдельно (ngrok / Cloudflare Tunnel)

## Запуск за 10 минут

Требуется Node.js 20+ (проверено на 24) и Docker.

### 1. База данных и Redis (1 мин)

```bash
docker compose up -d
docker compose ps   # оба контейнера должны быть healthy
```

### 2. Backend (4 мин)

```bash
cd backend
cp .env.example .env
# Заполните обязательные поля:
#   TELEGRAM_BOT_TOKEN       - токен бота от @BotFather
#   TELEGRAM_WEBHOOK_SECRET  - 1-256 символов: A-Z, a-z, 0-9, _ и -
npm install
npx prisma migrate dev --name init   # применит миграции (нужен запущенный PostgreSQL)
npm run start:dev                    # http://localhost:3000
```

Приложение **не стартует** без `TELEGRAM_BOT_TOKEN` и `TELEGRAM_WEBHOOK_SECRET` (строгая валидация env при загрузке).

### 3. Вебхук (2 мин)

В отдельном терминале поднимите туннель (вне compose):

```bash
ngrok http 3000
```

Установите вебхук с secret_token (обязательно — иначе все запросы получат 401):

```bash
curl "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -d "url=<HTTPS_URL>/webhook/telegram" \
  -d "secret_token=<SECRET>"
```

### 4. Frontend (2 мин)

```bash
cd frontend
npm install
npm run dev   # http://localhost:5173
```

### Проверка сценария

1. Отправьте боту `/start` — бот создаст контакт **без согласия** и пришлёт текст согласия с inline-кнопкой.
2. Нажмите «Согласен получать рассылки» — в БД заполнятся `telegramConsentAt`, `telegramConsentSource='bot_button'`, `telegramConsentVersion`.
3. `/stop` или кнопка «Отписаться» — мгновенно выставляет `telegramUnsubscribedAt`.
4. Создайте кампанию на фронтенде и запустите её: контакты без согласия получат статус `SKIPPED_NO_CONSENT` и сообщение им **не** уйдёт.

## Тесты

```bash
cd backend
npx jest                            # unit (воркер, env, per-chat лимитер)
npx jest --config test/jest-e2e.json  # e2e (секрет webhook, идемпотентность)
```

## Архитектура

```
backend/src/
├── config/      # строгая валидация env (старт без секретов невозможен)
├── prisma/      # PrismaService, схема: Contact, Message, Campaign, ProcessedEvent, ErrorLog
├── consent/     # единое место проверки условий (a)-(d)
├── channels/    # IChannelAdapter: telegram (webhook + Bot API), max (заглушка)
├── queue/       # BullMQ: QueueService, per-chat Redis-слоты, воркер SendMessageProcessor
├── contacts/    # REST CRUD
└── campaigns/   # REST + запуск рассылок
```

### Ключевые гарантии

- **Согласие (a)-(d)**: (a) есть ID канала, (b) `unsubscribedAt IS NULL`, (c) `consentAt IS NOT NULL`, (d) `blockedAt IS NULL`. Проверяется **дважды**: при постановке в очередь и в воркере непосредственно перед отправкой. `/start` сам по себе согласием не считается.
- **Идемпотентность**: `eventId = tg_<update_id>`, запись в `ProcessedEvent` и бизнес-логика в одной транзакции Prisma; дубль определяется по P2002 (никаких «findUnique → create»). Параллельные повторы вебхука обрабатываются безопасно.
- **Webhook**: сверка `X-Telegram-Bot-Api-Secret-Token` (timing-safe) → 401 при несовпадении; ответ 200 отдаётся сразу, обработка — асинхронно.
- **Лимиты отправки**: глобальный `TG_GLOBAL_RATE_PER_SEC` и per-chat `TG_PER_CHAT_RATE_PER_SEC` реализованы **Redis-слотами** (LUA-скрипт, ZSET) при постановке в очередь: job получает `delay` до свободного слота — воркер физически не может превысить лимит. Работа слотов покрыта unit-тестами.
- **Ошибки канала**: 429 → пауза `retry_after` (`moveToDelayed`); 403 → `contact.telegramBlockedAt` + FAILED без ретраев (`UnrecoverableError`); прочие → exponential backoff, запись в `ErrorLog` без ПДн.
- **BigInt-safe**: `telegramChatId` хранится как `String` — JSON-сериализация контактов без ошибок.
- **Job payload**: в очередь передаётся только `messageId` (UUID записи Message), не chat id.

### Risk notes

- **BullMQ 6 удалил queue-level `limiter`** (опция отсутствует в типах v6). Глобальный лимит поэтому реализован тем же слотовым механизмом в Redis (`rate:global:{channel}`), а не штатным limiter'ом BullMQ. Поведение эквивалентно (≤ N сообщений/сек на канал), механизм покрыт тестами.
- **Версии зависимостей**: зафиксированы `@prisma/client`/`prisma` 6.16.2 (схема из ТЗ рассчитана на `prisma-client-js`; Prisma 8 RC несовместим), `@nestjs/config` 4 и `@nestjs/bullmq` 11 (последние CJS-совместимые; v12 — ESM-only и ломает Jest/Vitest-CJS-инфраструктуру Nest).
- **Slotted per-chat limiter** резервирует слот при постановке в очередь. При рестарте приложения зарезервированные слоты сохраняются в Redis (TTL 2 окна), дубли не накапливаются за счёт `ZREMRANGEBYSCORE` в LUA-скрипте.
- **MAX** — заглушка адаптера: `sendMessage` бросает ошибку, реализация после проверки доступа к Bot API MAX. WhatsApp не тронут (Фаза 2).

## Полезные команды

```bash
docker compose up -d          # PostgreSQL + Redis
docker compose ps             # статус healthcheck
npx prisma migrate dev        # миграции (в backend/)
npx prisma studio             # визуальный просмотр БД
npm run start:dev             # backend в dev-режиме
npm run dev                   # frontend в dev-режиме
```
=======
# The-postman-Pechkin
Рассыльщик сообщений в мессенджерах 
>>>>>>> 3b7e0f3a8175a53a6777a01bc7834cdf22eb416d
