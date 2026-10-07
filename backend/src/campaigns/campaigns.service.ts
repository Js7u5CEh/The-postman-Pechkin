import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { CampaignStatus, Channel, MessageKind } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { QueueService } from '../queue/queue.service';

/** Данные для создания кампании. */
export interface CreateCampaignInput {
  name: string;
  channel: Channel;
  templateContent: string;
  kind?: MessageKind;
  scheduledAt?: Date | null;
}

/** Итог запуска кампании. */
export interface CampaignStartResult {
  queued: number;
  skipped: number;
  failed: number;
}

/**
 * Сервис кампаний: создание, запуск, учёт отправок.
 * Сообщения кампании ставятся в очередь через QueueService,
 * где выполняются consent-проверка и резерв per-chat слота.
 */
@Injectable()
export class CampaignsService {
  private readonly logger = new Logger(CampaignsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
  ) {}

  /** Создание кампании в статусе DRAFT. */
  async create(input: CreateCampaignInput) {
    return this.prisma.campaign.create({
      data: {
        name: input.name,
        channel: input.channel,
        kind: input.kind ?? MessageKind.MARKETING,
        templateContent: input.templateContent,
        scheduledAt: input.scheduledAt ?? null,
        status: CampaignStatus.DRAFT,
      },
    });
  }

  /** Список кампаний с количеством получателей. */
  async findAll(limit = 50, offset = 0) {
    const [items, total] = await this.prisma.$transaction([
      this.prisma.campaign.findMany({
        skip: offset,
        take: Math.min(limit, 200),
        orderBy: { createdAt: 'desc' },
        include: { _count: { select: { contacts: true } } },
      }),
      this.prisma.campaign.count(),
    ]);
    return { items, total };
  }

  /** Одна кампания со статусами получателей. */
  async findOne(id: string) {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id },
      include: { contacts: { include: { contact: true } } },
    });
    if (!campaign) {
      throw new NotFoundException(`Кампания ${id} не найдена`);
    }
    return campaign;
  }

  /**
   * Запуск кампании: для каждого контакта канала создаётся Message(MARKETING)
   * и CampaignContact, затем постановка в очередь (consent + rate в QueueService).
   */
  async start(campaignId: string): Promise<CampaignStartResult> {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
    });
    if (!campaign) {
      throw new NotFoundException(`Кампания ${campaignId} не найдена`);
    }
    if (campaign.status !== CampaignStatus.DRAFT && campaign.status !== CampaignStatus.PAUSED) {
      throw new Error(`Кампания ${campaignId} не может быть запущена (status=${campaign.status})`);
    }

    // Получатели: контакты, у которых есть ID в канале кампании (условие (a)).
    const contacts = await this.prisma.contact.findMany({
      where:
        campaign.channel === Channel.TELEGRAM
          ? { telegramChatId: { not: null } }
          : campaign.channel === Channel.MAX
            ? { maxUserId: { not: null } }
            : { whatsappPhone: { not: null } },
    });

    const result: CampaignStartResult = { queued: 0, skipped: 0, failed: 0 };

    await this.prisma.campaign.update({
      where: { id: campaignId },
      data: { status: CampaignStatus.RUNNING, startedAt: campaign.startedAt ?? new Date() },
    });

    for (const contact of contacts) {
      try {
        // Message для получателя (конкурентно-безопасно: повторный start не дублирует).
        const message = await this.prisma.message.create({
          data: {
            contactId: contact.id,
            channel: campaign.channel,
            direction: 'OUTBOUND',
            kind: campaign.kind,
            content: campaign.templateContent,
            status: 'QUEUED',
            campaignId,
          },
        });
        await this.prisma.campaignContact.upsert({
          where: { campaignId_contactId: { campaignId, contactId: contact.id } },
          create: { campaignId, contactId: contact.id, status: 'PENDING' },
          update: { status: 'PENDING' },
        });

        // Consent-проверка и per-chat rate — внутри QueueService.
        await this.queue.enqueueMessage(message.id);
        result.queued++;
      } catch (err) {
        result.failed++;
        this.logger.warn(
          `Кампания ${campaignId}: не удалось поставить сообщение для ${contact.id}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    this.logger.log(
      `Кампания ${campaignId}: queued=${result.queued}, failed=${result.failed}`,
    );
    return result;
  }
}
