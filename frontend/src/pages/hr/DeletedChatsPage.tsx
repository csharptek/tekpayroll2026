import { useState } from 'react'
import { RotateCcw, Loader2, Search, CheckCircle2 } from 'lucide-react'
import { teamsChatApi } from '../../services/api'
import { PageHeader, Card } from '../../components/ui'

export default function DeletedChatsPage() {
  const [chatId, setChatId] = useState('')
  const [checking, setChecking] = useState(false)
  const [checked, setChecked] = useState<{ id: string } | null>(null)
  const [restoring, setRestoring] = useState(false)
  const [restored, setRestored] = useState(false)
  const [error, setError] = useState('')

  const checkChat = async () => {
    if (!chatId.trim()) return
    setChecking(true)
    setError('')
    setChecked(null)
    setRestored(false)
    try {
      const { data } = await teamsChatApi.checkDeletedChat(chatId.trim())
      setChecked(data)
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Chat not found in deleted items (may be outside 7-day window, or ID is wrong)')
    } finally {
      setChecking(false)
    }
  }

  const restore = async () => {
    setRestoring(true)
    setError('')
    try {
      await teamsChatApi.restoreChat(chatId.trim())
      setRestored(true)
      setChecked(null)
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Restore failed')
    } finally {
      setRestoring(false)
    }
  }

  return (
    <div>
      <PageHeader title="Restore Deleted Chat" subtitle="Paste a chat ID to restore it (only works within 7 days of deletion)" />

      <Card>
        <label className="text-sm font-medium text-gray-700 mb-1 block">Chat ID</label>
        <div className="flex gap-3">
          <input
            className="flex-1 border rounded-lg px-3 py-2 font-mono text-sm"
            placeholder="19:xxxxxxxx_xxxxxxxx@unq.gbl.spaces"
            value={chatId}
            onChange={(e) => { setChatId(e.target.value); setChecked(null); setRestored(false); setError('') }}
          />
          <button
            className="bg-blue-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 disabled:opacity-50"
            disabled={!chatId.trim() || checking}
            onClick={checkChat}
          >
            {checking ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            Check
          </button>
        </div>

        {error && <p className="text-red-600 text-sm mt-3">{error}</p>}

        {checked && (
          <div className="mt-4 border rounded-lg p-4 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-green-700">Found — eligible to restore</p>
              <p className="text-xs text-gray-500 font-mono mt-1 break-all">{checked.id}</p>
            </div>
            <button
              className="bg-green-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 disabled:opacity-50 shrink-0 ml-3"
              disabled={restoring}
              onClick={restore}
            >
              {restoring ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
              Restore
            </button>
          </div>
        )}

        {restored && (
          <div className="mt-4 border border-green-200 bg-green-50 rounded-lg p-4 flex items-center gap-2 text-green-700">
            <CheckCircle2 className="w-5 h-5" />
            Chat restored. Participants should regain access shortly once their Teams client refreshes.
          </div>
        )}
      </Card>
    </div>
  )
}
