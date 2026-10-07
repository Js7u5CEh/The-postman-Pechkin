
# ЗАДАЧИ ПЕРВОГО ЭПИКА (ШАГИ 1–2)


## Задача 1. Структура проекта

```text
mvp-broadcast-service/
├── backend/
│   ├── src/
│   │   ├── main.ts
│   │   ├── app.module.ts
│   │   ├── config/                  # валидация env (приложение не стартует без секретов)
│   │   ├── channels/
│   │   │   ├── channel-adapter.interface.ts   # IChannelAdapter
│   │   │   ├── telegram/
│   │   │   │   ├── telegram.module.ts
│   │   │   │   ├── telegram.adapter.ts        # sendMessage, verifyWebhook, parseWebhook
│   │   │   │   ├── telegram.service.ts        # обработка update: start, consent, stop, my_chat_member
│   │   │   │   └── telegram.controller.ts     # POST /webhook/telegram
│   │   │   └── max/                           # заглушка адаптера
│   │   ├── contacts/
│   │   ├── campaigns/
│   │   ├── consent/                 # единое место проверки условий (a)-(d)
│   │   ├── queue/
│   │   │   ├── queue.module.ts
│   │   │   ├── queue.service.ts
│   │   │   └── send-message.processor.ts      # воркер: проверка согласия, отправка, retry
│   │   └── prisma/
│   ├── prisma/schema.prisma
│   ├── package.json
│   └── tsconfig.json
├── frontend/                        # Vite + React + TS + Tailwind + shadcn/ui
│   └── src/ (App.tsx, pages/Contacts.tsx, pages/Campaigns.tsx, components/)
├── docker-compose.yml
├── .env.example
└── README.md
```


## Задача 2. Инициализация

Backend (не использовать npx nest generate app, не ставить bull и redis):

```bash
npx @nestjs/cli new backend --package-manager npm --strict
cd backend
npm install @nestjs/config @nestjs/bullmq bullmq ioredis @prisma/client axios class-validator class-transformer
npm install -D prisma
npx prisma init
```

Frontend:

```bash
npm create vite@latest frontend -- --template react-ts
cd frontend
npm install zustand react-hook-form zod @hookform/resolvers
# затем Tailwind и shadcn/ui по актуальной официальной инструкции
```

.env.example:

```env
# Database
DATABASE_URL="postgresql://mvp_user:mvp_password@localhost:5432/mvp_db"

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379

# Telegram (обязательные)
TELEGRAM_BOT_TOKEN=
TELEGRAM_WEBHOOK_SECRET=   # 1-256 символов: A-Z, a-z, 0-9, _ и -

# Версия текста согласия
CONSENT_TEXT_VERSION=v1

# Лимиты отправки
TG_GLOBAL_RATE_PER_SEC=30
TG_PER_CHAT_RATE_PER_SEC=1

# MAX (после проверки доступа)
MAX_BOT_TOKEN=
MAX_WEBHOOK_SECRET=

# Туннель (опционально)
NGROK_AUTHTOKEN=
```


## Задача 3. Telegram webhook

Требования к реализации (пиши код сам, следуя им):

- Контроллер POST /webhook/telegram сверяет заголовок X-Telegram-Bot-Api-Secret-Token с TELEGRAM_WEBHOOK_SECRET; при несовпадении — UnauthorizedException. Проверка не закомментирована.
- Обработка update выполняется в одной транзакции prisma.$transaction: сначала processedEvent.create, при P2002 — вернуть без действий (дубль), затем бизнес-логика.
Поддерживаемые события:

- /start: создать/найти контакт по telegramChatId (String) БЕЗ согласия; отправить текст согласия с inline-кнопкой (через очередь, kind = SERVICE).
- callback_query с данными consent:yes: выставить telegramConsentAt = now(), telegramConsentSource = 'bot_button', telegramConsentVersion = CONSENT_TEXT_VERSION, сбросить telegramUnsubscribedAt. Ответить answerCallbackQuery.
- /stop и callback_query consent:stop: выставить telegramUnsubscribedAt = now(), отправить подтверждение.
- my_chat_member со статусом kicked: выставить telegramBlockedAt; статус member: сбросить.
- Прочие сообщения: логировать только тип события и id, без полного payload.
Воркер send-message.processor.ts:

- Загружает Message по messageId и связанный контакт.
- Для kind = MARKETING проверяет условия (a)–(d) через модуль consent; при нарушении ставит SKIPPED_NO_CONSENT и не отправляет.
- При 429 использует retry_after; при 403 ставит blockedAt и не ретраит; прочие ошибки — exponential backoff.
- Ответ вебхука возвращается быстро (200), тяжёлая работа — через очередь.
- Добавить в README команду установки webhook с secret_token:
- `curl "https://api.telegram.org/bot<TOKEN>/setWebhook" -d "url=<HTTPS_URL>/webhook/telegram" -d "secret_token=<SECRET>"`.


# КРИТЕРИИ УСПЕХА ШАГОВ 1–2

- docker compose up -d поднимает PostgreSQL и Redis (с healthcheck); backend запускается отдельно через npm run start:dev, это описано в README.
- npx prisma migrate dev --name init создаёт все таблицы, enum, индексы и связи.
- Приложение не стартует без TELEGRAM_WEBHOOK_SECRET и TELEGRAM_BOT_TOKEN.
- Webhook с неверным секретом получает 401.
- /start создаёт контакт БЕЗ согласия; после нажатия кнопки согласия заполняются telegramConsentAt, source и version.
- /stop выставляет telegramUnsubscribedAt, рекламные сообщения такому контакту не отправляются (воркер помечает SKIPPED_NO_CONSENT).
- Повторный webhook с тем же update_id не создаёт дублей, в том числе при параллельных запросах.
- Контакты сериализуются в JSON без ошибок.
- Есть e2e/unit-тесты на: идемпотентность, проверку секрета, проверку условий согласия в воркере.
- README позволяет новому разработчику запустить проект за 10 минут.
