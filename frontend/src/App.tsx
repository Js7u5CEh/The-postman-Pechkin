import { useState } from 'react'
import Contacts from '@/pages/Contacts'
import Campaigns from '@/pages/Campaigns'
import { Button } from '@/components/ui/button'

type Tab = 'contacts' | 'campaigns'

/** Корневой компонент MVP: две страницы без роутера. */
function App() {
  const [tab, setTab] = useState<Tab>('contacts')

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">MVP Broadcast Service</h1>
        <p className="text-sm text-muted-foreground">
          Рассылки с проверкой согласий (152-ФЗ) — Telegram и MAX.
        </p>
      </header>

      <nav className="mb-6 flex gap-2">
        <Button variant={tab === 'contacts' ? 'default' : 'outline'} onClick={() => setTab('contacts')}>
          Контакты
        </Button>
        <Button variant={tab === 'campaigns' ? 'default' : 'outline'} onClick={() => setTab('campaigns')}>
          Кампании
        </Button>
      </nav>

      <main>{tab === 'contacts' ? <Contacts /> : <Campaigns />}</main>
    </div>
  )
}

export default App
