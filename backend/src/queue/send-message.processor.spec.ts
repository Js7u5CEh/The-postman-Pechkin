import 'reflect-metadata';
import { Job, UnrecoverableError } from 'bullmq';
import { Channel, MessageKind, MessageStatus } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { ConsentService } from '../consent/consent.service';
import { ChannelError } from '../channels/channel-adapter.interface';
import { TelegramAdapter } from '../channels/telegram/telegram.adapter';
import { SendMessageProcessor } from './send-message.processor';

const sendMessageMock = jest.fn<Promise<{ externalId: string }>, [string, string]>();
const telegramMock = { sendMessage: sendMessageMock } as unknown as TelegramAdapter;

const prismaMock = {
  message: { findUnique: jest.fn(), update: jest.fn() },
  contact: { update: jest.fn() },
  errorLog: { create: jest.fn() },
  $transaction: jest.fn(),
};

const configService = {
  getOrThrow: (key: string) =>
    key === 'TELEGRAM_BOT_TOKEN' ? 'test-token' : 'v1',
} as unknown as ConfigService;

function makeJob(partial: Partial<Job> = {}): Job {
  return {
    id: 'msg-1',
    attemptsMade: 0,
    opts: { attempts: 5 },
    data: { messageId: 'msg-1' },
    token: 'test-token',
    moveToDelayed: jest.fn().mockResolvedValue(undefined),
    ...partial,
  } as unknown as Job;
}

const okContact = {
  id: 'contact-1',
  telegramChatId: '555000111',
  telegramConsentAt: new Date(),
  telegramUnsubscribedAt: null,
  telegramBlockedAt: null,
};

const baseMessage = (contact: object, kind: MessageKind = MessageKind.MARKETING) => ({
  id: 'msg-1',
  contactId: 'contact-1',
  channel: Channel.TELEGRAM,
  direction: 'OUTBOUND',
  kind,
  content: 'Привет!',
  status: MessageStatus.QUEUED,
  contact,
});

describe('SendMessageProcessor', () => {
  let processor: SendMessageProcessor;

  beforeEach(() => {
    jest.clearAllMocks();
    prismaMock.message.update.mockResolvedValue({});
    processor = new SendMessageProcessor(
      prismaMock as never,
      new ConsentService(),
      configService,
      telegramMock,
      {} as never,
    );
  });

  it('отправляет MARKETING при выполненных условиях (a)-(d)', async () => {
    prismaMock.message.findUnique.mockResolvedValue(baseMessage(okContact));
    sendMessageMock.mockResolvedValue({ externalId: '42' });

    await processor.process(makeJob());

    expect(telegramMock.sendMessage).toHaveBeenCalledWith('555000111', 'Привет!');
    expect(prismaMock.message.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'msg-1' },
        data: expect.objectContaining({ status: MessageStatus.SENT }),
      }),
    );
  });

  it.each([
    ['нет ID канала', { ...okContact, telegramChatId: null }],
    ['нет согласия', { ...okContact, telegramConsentAt: null }],
    ['отписан', { ...okContact, telegramUnsubscribedAt: new Date() }],
    ['бот заблокирован', { ...okContact, telegramBlockedAt: new Date() }],
  ])('MARKETING пропускается (%s)', async (_label, contact) => {
    prismaMock.message.findUnique.mockResolvedValue(baseMessage(contact));

    await processor.process(makeJob());

    expect(telegramMock.sendMessage).not.toHaveBeenCalled();
    expect(prismaMock.message.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: MessageStatus.SKIPPED_NO_CONSENT }),
      }),
    );
  });

  it('SERVICE отправляется без согласия', async () => {
    prismaMock.message.findUnique.mockResolvedValue(
      baseMessage({ ...okContact, telegramConsentAt: null }, MessageKind.SERVICE),
    );
    sendMessageMock.mockResolvedValue({ externalId: '43' });

    await processor.process(makeJob());

    expect(telegramMock.sendMessage).toHaveBeenCalled();
    expect(prismaMock.message.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: MessageStatus.SENT }),
      }),
    );
  });

  it('403 -> blockedAt + FAILED без ретраев', async () => {
    prismaMock.message.findUnique.mockResolvedValue(baseMessage(okContact));
    sendMessageMock.mockRejectedValue(
      new ChannelError('bot was blocked by the user', 'BLOCKED'),
    );
    prismaMock.$transaction.mockImplementation((arr: unknown[]) => Promise.all(arr));

    await expect(processor.process(makeJob())).rejects.toBeInstanceOf(UnrecoverableError);

    expect(prismaMock.contact.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ telegramBlockedAt: expect.any(Date) }),
      }),
    );
  });

  it('429 -> moveToDelayed по retry_after', async () => {
    prismaMock.message.findUnique.mockResolvedValue(baseMessage(okContact));
    sendMessageMock.mockRejectedValue(
      new ChannelError('Too Many Requests', 'RATE_LIMITED', 2500),
    );

    const job = makeJob();
    await processor.process(job);

    expect(job.moveToDelayed).toHaveBeenCalledWith(expect.any(Number), 'test-token');
  });
});
