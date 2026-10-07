import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Сервис контактов: CRUD для фронтенда.
 * Chat id хранится как String — сериализация в JSON безопасна (см. критерий успеха).
 */
@Injectable()
export class ContactsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Список контактов с пагинацией. */
  async findAll(limit = 50, offset = 0) {
    const [items, total] = await this.prisma.$transaction([
      this.prisma.contact.findMany({
        skip: offset,
        take: Math.min(limit, 200),
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.contact.count(),
    ]);
    return { items, total };
  }

  /** Создание контакта (канальные ID не принимаются — только из каналов). */
  async create(data: { name?: string; email?: string; city?: string; tags?: string[] }) {
    return this.prisma.contact.create({
      data: { name: data.name, email: data.email, city: data.city, tags: data.tags ?? [] },
    });
  }

  /** Один контакт по id. */
  async findOne(id: string) {
    const contact = await this.prisma.contact.findUnique({
      where: { id },
      include: { messages: { orderBy: { createdAt: 'desc' }, take: 20 } },
    });
    if (!contact) {
      throw new NotFoundException(`Контакт ${id} не найден`);
    }
    return contact;
  }

  /** Обновление произвольных полей контакта (без канальных ID — они приходят из каналов). */
  async update(id: string, data: Prisma.ContactUpdateInput) {
    await this.ensureExists(id);
    return this.prisma.contact.update({ where: { id }, data });
  }

  /** Удаление контакта. */
  async remove(id: string): Promise<void> {
    await this.ensureExists(id);
    await this.prisma.contact.delete({ where: { id } });
  }

  private async ensureExists(id: string): Promise<void> {
    const exists = await this.prisma.contact.findUnique({ where: { id }, select: { id: true } });
    if (!exists) {
      throw new NotFoundException(`Контакт ${id} не найден`);
    }
  }
}
