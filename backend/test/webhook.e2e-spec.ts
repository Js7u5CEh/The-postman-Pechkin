import 'reflect-metadata';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { QueueService } from '../src/queue/queue.service';
import { SendMessageProcessor } from '../src/queue/send-message.processor';

/**
 * E2E webhook-тесты с реальным TelegramAdapter (verifyWebhook + parseWebhook).
 * Мокаются только PrismaService (идемпотентность через Set + P2002)
 * и QueueService (BullMQ не поднимается).
 */
describe('Telegram webhook (e2e)', () => {
  let app: INestApplication;

  // Стабильные моки транзакционного клиента (одни и те же объекты на все тесты)
  const txProcessedEventCreate = jest.fn();
  const txContactUpsert = jest.fn();
  const txContactUpdateMany = jest.fn();
  const txMessageCreate = jest.fn();

  // Совпадает с TELEGRAM_WEBHOOK_SECRET в backend/.env (локальная разработка)
  const SECRET = 'local-dev-secret-change-me';

  const startUpdate = (updateId: number, chatId: number) => ({
    update_id: updateId,
    message: {
      message_id: updateId,
      chat: { id: chatId, type: 'private', first_name: 'Ivan' },
      date: 1700000000,
      text: '/start',
    },
  });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue({
        $transaction: jest.fn(),
        processedEvent: { create: txProcessedEventCreate },
        contact: { upsert: txContactUpsert, updateMany: txContactUpdateMany },
        message: { create: txMessageCreate },
      })
      .overrideProvider(QueueService)
      .useValue({ enqueueMessage: jest.fn().mockResolvedValue(undefined) })
      // Воркер в e2e не нужен: иначе он подключится к реальному Redis и заберёт job'ы
      .overrideProvider(SendMessageProcessor)
      .useValue({ process: jest.fn(), onModuleInit: jest.fn() })
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    await app.init();

    // $transaction -> вызов колбэка с транзакционным клиентом (наши моки)
    (app.get(PrismaService).$transaction as jest.Mock).mockImplementation(
      async (cb: (tx: object) => Promise<unknown>) =>
        cb({
          processedEvent: { create: txProcessedEventCreate },
          contact: { upsert: txContactUpsert, updateMany: txContactUpdateMany },
          message: { create: txMessageCreate },
        }),
    );
  });

  beforeEach(() => {
    jest.clearAllMocks();

    // Идемпотентность: processedEvent.create бросает P2002 на повторном eventId
    const seen = new Set<string>();
    txProcessedEventCreate.mockImplementation(({ data }: { data: { eventId: string } }) => {
      if (seen.has(data.eventId)) {
        throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
      }
      seen.add(data.eventId);
      return {};
    });
    txContactUpsert.mockResolvedValue({ id: 'c1', telegramChatId: '1' });
    txContactUpdateMany.mockResolvedValue({ count: 1 });
    txMessageCreate.mockResolvedValue({ id: 'm1' });
  });

  const post = (body: object, header?: string) =>
    request(app.getHttpServer())
      .post('/webhook/telegram')
      .set('x-telegram-bot-api-secret-token', header ?? SECRET)
      .send(body);

  it('401 при неверном секрете', async () => {
    const res = await post(startUpdate(1, 100), 'wrong-secret');
    expect(res.status).toBe(401);
  });

  it('401 без заголовка', async () => {
    const res = await request(app.getHttpServer())
      .post('/webhook/telegram')
      .send(startUpdate(2, 100));
    expect(res.status).toBe(401);
  });

  it('200 с верным секретом, /start обрабатывается (контакт + сообщение)', async () => {
    const res = await post(startUpdate(3, 100));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });

    await new Promise((r) => setTimeout(r, 30));
    expect(txContactUpsert).toHaveBeenCalledTimes(1);
    expect(txMessageCreate).toHaveBeenCalledTimes(1);
    // Важно: /start создаёт контакт БЕЗ согласия
    expect(txContactUpsert.mock.calls[0][0].create.telegramConsentAt).toBeUndefined();
  });

  it('повторный update_id не создаёт дублей', async () => {
    await post(startUpdate(4, 100));
    await post(startUpdate(4, 100));
    await new Promise((r) => setTimeout(r, 30));

    // Второй запрос отсеян по P2002: upsert вызван ровно один раз
    expect(txContactUpsert).toHaveBeenCalledTimes(1);
  });

  it('параллельные запросы с одним update_id — обработка только одна', async () => {
    await Promise.all([post(startUpdate(5, 100)), post(startUpdate(5, 100))]);
    await new Promise((r) => setTimeout(r, 30));

    const calls = txContactUpsert.mock.calls.filter(
      (c: Array<{ where: { telegramChatId: string } }>) => c[0].where.telegramChatId === '100',
    );
    expect(calls).toHaveLength(1);
  });

  afterAll(async () => {
    await app.close();
  });
});
