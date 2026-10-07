import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { useCampaignsStore } from '@/stores/campaigns.store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

/** Схема формы кампании. */
const campaignFormSchema = z.object({
  name: z.string().min(1, 'Укажите название'),
  channel: z.enum(['TELEGRAM', 'MAX']),
  templateContent: z.string().min(1, 'Введите текст сообщения'),
})
type CampaignFormValues = z.infer<typeof campaignFormSchema>

/** Человекочитаемый статус кампании. */
const statusLabels: Record<string, string> = {
  DRAFT: 'черновик',
  SCHEDULED: 'запланирована',
  RUNNING: 'запущена',
  PAUSED: 'пауза',
  COMPLETED: 'завершена',
}

/** Страница кампаний. */
export default function Campaigns() {
  const { items, total, loading, error, load, add, start } = useCampaignsStore()
  const [notice, setNotice] = useState<string | null>(null)

  const form = useForm<CampaignFormValues>({
    resolver: zodResolver(campaignFormSchema),
    defaultValues: { name: '', channel: 'TELEGRAM', templateContent: '' },
  })

  useEffect(() => {
    void load()
  }, [load])

  const onSubmit = form.handleSubmit(async (values) => {
    await add(values)
    form.reset()
  })

  const onStart = async (id: string) => {
    try {
      setNotice(await start(id))
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Не удалось запустить кампанию')
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Новая кампания</CardTitle>
          <CardDescription>
            Рекламная рассылка уходит только контактам с согласием; не более 1 сообщения/сек на чат.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-3">
            <div className="flex flex-col gap-3 sm:flex-row">
              <div className="flex-1 space-y-1">
                <Input placeholder="Название кампании" {...form.register('name')} />
                {form.formState.errors.name && (
                  <p className="text-xs text-destructive">{form.formState.errors.name.message}</p>
                )}
              </div>
              <select
                className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
                {...form.register('channel')}
              >
                <option value="TELEGRAM">Telegram</option>
                <option value="MAX">MAX</option>
              </select>
            </div>
            <div className="space-y-1">
              <Textarea
                placeholder="Текст сообщения (шаблон)"
                rows={4}
                {...form.register('templateContent')}
              />
              {form.formState.errors.templateContent && (
                <p className="text-xs text-destructive">
                  {form.formState.errors.templateContent.message}
                </p>
              )}
            </div>
            <Button type="submit" disabled={form.formState.isSubmitting}>
              Создать кампанию
            </Button>
          </form>
        </CardContent>
      </Card>

      {notice && <p className="text-sm text-muted-foreground">{notice}</p>}

      <Card>
        <CardHeader>
          <CardTitle>Кампании ({total})</CardTitle>
          <CardDescription>Запуск ставит сообщения в очередь с проверкой согласий.</CardDescription>
        </CardHeader>
        <CardContent>
          {error && <p className="mb-3 text-sm text-destructive">{error}</p>}
          {loading ? (
            <p className="text-sm text-muted-foreground">Загрузка…</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Название</TableHead>
                  <TableHead>Канал</TableHead>
                  <TableHead>Статус</TableHead>
                  <TableHead>Получателей</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-sm text-muted-foreground">
                      Кампаний пока нет.
                    </TableCell>
                  </TableRow>
                )}
                {items.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell>{c.name}</TableCell>
                    <TableCell>{c.channel}</TableCell>
                    <TableCell>{statusLabels[c.status] ?? c.status}</TableCell>
                    <TableCell>{c._count?.contacts ?? 0}</TableCell>
                    <TableCell className="text-right">
                      {c.status === 'DRAFT' && (
                        <Button size="sm" variant="outline" onClick={() => void onStart(c.id)}>
                          Запустить
                        </Button>
                      )}
                    </TableCell>
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
