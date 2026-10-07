import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { useContactsStore } from '@/stores/contacts.store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

/** Схема формы контакта. */
const contactFormSchema = z.object({
  name: z.string().min(1, 'Укажите имя'),
  email: z.string().email('Некорректный email'),
  city: z.string().optional(),
})
type ContactFormValues = z.infer<typeof contactFormSchema>

/** Форматирование согласия для таблицы. */
function consentBadge(contact: { telegramConsentAt: string | null; telegramUnsubscribedAt: string | null; telegramBlockedAt: string | null }) {
  if (contact.telegramBlockedAt) return 'заблокирован'
  if (contact.telegramUnsubscribedAt) return 'отписан'
  if (contact.telegramConsentAt) return 'согласие ✔'
  return 'нет согласия'
}

/** Страница контактов. */
export default function Contacts() {
  const { items, total, loading, error, load, add } = useContactsStore()

  const form = useForm<ContactFormValues>({
    resolver: zodResolver(contactFormSchema),
    defaultValues: { name: '', email: '', city: '' },
  })

  useEffect(() => {
    void load()
  }, [load])

  const onSubmit = form.handleSubmit(async (values) => {
    await add(values)
    form.reset()
  })

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Новый контакт</CardTitle>
          <CardDescription>Канальные ID и согласия фиксируются только через бота.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="flex flex-col gap-3 sm:flex-row sm:items-start">
            <div className="flex-1 space-y-1">
              <Input placeholder="Имя" {...form.register('name')} />
              {form.formState.errors.name && (
                <p className="text-xs text-destructive">{form.formState.errors.name.message}</p>
              )}
            </div>
            <div className="flex-1 space-y-1">
              <Input placeholder="email@example.com" {...form.register('email')} />
              {form.formState.errors.email && (
                <p className="text-xs text-destructive">{form.formState.errors.email.message}</p>
              )}
            </div>
            <div className="flex-1">
              <Input placeholder="Город (необязательно)" {...form.register('city')} />
            </div>
            <Button type="submit" disabled={form.formState.isSubmitting}>
              Добавить
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Контакты ({total})</CardTitle>
          <CardDescription>Chat id хранится строкой — сериализация в JSON безопасна.</CardDescription>
        </CardHeader>
        <CardContent>
          {error && <p className="mb-3 text-sm text-destructive">{error}</p>}
          {loading ? (
            <p className="text-sm text-muted-foreground">Загрузка…</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Имя</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Telegram chat id</TableHead>
                  <TableHead>Согласие</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-sm text-muted-foreground">
                      Контактов пока нет. Отправьте боту /start или добавьте вручную.
                    </TableCell>
                  </TableRow>
                )}
                {items.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell>{c.name ?? '—'}</TableCell>
                    <TableCell>{c.email ?? '—'}</TableCell>
                    <TableCell className="font-mono text-xs">{c.telegramChatId ?? '—'}</TableCell>
                    <TableCell>{consentBadge(c)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
