/** Минимальные типы Telegram Bot API для Шагов 1-2. */

export interface TgUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
}

export interface TgChat {
  id: number; // BigInt в Telegram — в БД храним как String
  type: 'private' | 'group' | 'supergroup' | 'channel';
  title?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
}

export interface TgInlineKeyboardButton {
  text: string;
  callback_data: string;
}

export interface TgMessage {
  message_id: number;
  from?: TgUser;
  chat: TgChat;
  date: number;
  text?: string;
}

export interface TgCallbackQuery {
  id: string;
  from: TgUser;
  message?: TgMessage;
  data?: string;
}

export interface TgChatMemberUpdated {
  chat: TgChat;
  from: TgUser;
  date: number;
  new_chat_member: { status: 'creator' | 'administrator' | 'member' | 'restricted' | 'left' | 'kicked'; user: TgUser };
}

export interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  edited_message?: TgMessage;
  channel_post?: TgMessage;
  callback_query?: TgCallbackQuery;
  my_chat_member?: TgChatMemberUpdated;
}

export interface TgApiResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
  parameters?: { retry_after?: number };
  error_code?: number;
}

/** Дискриминаторы событий, которые мы поддерживаем. */
export type TelegramEventType =
  | { type: 'start'; chatId: string; username?: string }
  | { type: 'stop'; chatId: string }
  | { type: 'consent_yes'; chatId: string; callbackQueryId: string }
  | { type: 'consent_stop'; chatId: string; callbackQueryId: string }
  | { type: 'my_chat_member'; chatId: string; blocked: boolean }
  | { type: 'ignored'; chatId?: string };

/** Уникальный идентификатор события для ProcessedEvent. */
export function telegramEventId(updateId: number): string {
  return `tg_${updateId}`;
}

/** Chat id как строка (BigInt-safe). */
export function chatIdToString(id: number | string): string {
  return String(id);
}
