/**
 * Тексты и клавиатуры Telegram-бота (Шаги 1-2).
 * Комментарии на русском.
 */

/** Текст согласия, отправляемый после /start (версия хранится в CONSENT_TEXT_VERSION). */
export const CONSENT_MESSAGE_TEXT =
  'Здравствуйте! Вы подписались на бота рассылок.\n\n' +
  'Мы можем отправлять вам рекламные сообщения только с вашего явного согласия ' +
  '(152-ФЗ). Нажмите кнопку «Согласен получать рассылки», чтобы подтвердить согласие.\n\n' +
  'Отписаться можно в любой момент командой /stop или кнопкой «Отписаться».';

/** Inline-клавиатура согласия: callback_data фиксируются в адаптере и сервисе. */
export function buildConsentKeyboard(): { inline_keyboard: { text: string; callback_data: string }[][] } {
  return {
    inline_keyboard: [
      [{ text: '✅ Согласен получать рассылки', callback_data: 'consent:yes' }],
      [{ text: '❌ Отписаться', callback_data: 'consent:stop' }],
    ],
  };
}

/** Подтверждение отписки. */
export function stoppedText(): string {
  return 'Вы отписаны от рассылки. Рекламные сообщения больше не будут отправляться.';
}
