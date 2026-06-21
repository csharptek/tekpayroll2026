import { useEffect, useState } from 'react'
import { RotateCcw, Loader2, MessageSquareOff } from 'lucide-react'
import { teamsChatApi } from '../../services/api'
import { PageHeader, Card } from '../../components/ui'
import { format } from 'date-fns'

interface DeletedChat {
  id: string
  chatId: string
  deletedDateTime?: string
}

export default function DeletedChatsPage() {
  const [chats, setChats] = useState<DeletedChat[]>([])
  const [loading, setLoading] = useState(true)
  const [restoringId, setRestoringId] = useState<string | null>(null)
  const [error, setError] = useState('')

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const { data } = await teamsChatApi.deletedChats()
      setChats(data.chats)
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Failed to load deleted chats')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const restore = async (chatId: string) => {
    setRestoringId(chatId)
    try {
      await teamsChatApi.restoreChat(chatId)
      setChats((prev) => prev.filter((c) => c.id !== chatId))
    } finally {
      setRestoringId(null)
    }
  }

  return (
    <div>
      <PageHeader title="Deleted Chats" subtitle="Restore chats deleted within the last 7 days" />

      {loading && (
        <div className="flex justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
        </div>
      )}

      {error && <p className="text-red-600 text-sm">{error}</p>}

      {!loading && !error && chats.length === 0 && (
        <Card>
          <div className="text-center py-8 text-gray-500">
            <MessageSquareOff className="w-8 h-8 mx-auto mb-2 text-gray-300" />
            No deleted chats in the last 7 days.
          </div>
        </Card>
      )}

      {chats.length > 0 && (
        <Card>
          <div className="divide-y">
            {chats.map((c) => (
              <div key={c.id} className="py-3 flex items-center justify-between">
                <div>
                  <div className="font-mono text-xs text-gray-500 break-all">{c.id}</div>
                  {c.deletedDateTime && (
                    <div className="text-xs text-gray-400 mt-1">
                      Deleted {format(new Date(c.deletedDateTime), 'dd MMM yyyy, HH:mm')}
                    </div>
                  )}
                </div>
                <button
                  className="bg-blue-600 text-white px-3 py-1.5 rounded-lg flex items-center gap-2 text-sm disabled:opacity-50 shrink-0 ml-3"
                  disabled={restoringId === c.id}
                  onClick={() => restore(c.id)}
                >
                  {restoringId === c.id ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <RotateCcw className="w-4 h-4" />
                  )}
                  Restore
                </button>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  )
}
