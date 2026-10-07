import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { IsArray, IsEmail, IsOptional, IsString } from 'class-validator';
import { ContactsService } from './contacts.service';

/** DTO создания контакта. */
export class CreateContactDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsArray()
  tags?: string[];
}

/** DTO обновления контакта. */
export class UpdateContactDto extends CreateContactDto {}

/** REST API контактов для фронтенда. */
@Controller('contacts')
export class ContactsController {
  constructor(private readonly contacts: ContactsService) {}

  @Get()
  findAll(
    @Query('limit', new ParseIntPipe({ optional: true })) limit = 50,
    @Query('offset', new ParseIntPipe({ optional: true })) offset = 0,
  ) {
    return this.contacts.findAll(limit, offset);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.contacts.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateContactDto) {
    // Канальные ID (telegramChatId и т.п.) не принимаем извне — только из каналов.
    return this.contacts.create(dto);
  }

  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateContactDto) {
    return this.contacts.update(id, {
      name: dto.name,
      email: dto.email,
      city: dto.city,
      tags: dto.tags,
    });
  }

  @Delete(':id')
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    await this.contacts.remove(id);
    return { ok: true };
  }


}
