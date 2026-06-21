import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { MessageSquare, Trash2, Loader2, Users, Search } from 'lucide-react'
import { teamsChatApi } from '../../services/api'
import { PageHeader, Card } from '../../components/ui'
import { format } from 'date-fns'

interface Employee {
  id: string
  name: string
  email: string
  employeeCode: string
  entraId: string
}

interface Chat {
  id: string
  topic: string | null
  chatType: string
  lastUpdated: string
  members: string[]
}

export default function TeamsChatCleanupPage() {
  const [selectedEntraId, setSelectedEntraId] = useState('')
  const [confirmChat, setConfirmChat] = useState<Chat | null>(null)
  const qc = useQueryClient()

  const { data: employees = [] } = useQuery<Employee[]>({
    queryKey: ['teams-chat-employees'],
    queryFn: async () => (await teamsChatApi.employees()).data,
  })

  const { data: chats = [], isFetching, refetch } = useQuery<Chat[]>({
    queryKey: ['teams-chats', selectedEntraId],
    queryFn: async () => (await teamsChatApi.chats(selectedEntraId)).data,
    enabled: false,
  })

  const deleteMutation = useMutation({
    mutationFn: (chatId: string) => teamsChatApi.deleteChat(chatId),
    onSuccess: () => {
      setConfirmChat(null)
      qc.setQueryData<Chat[]>(['teams-chats', selectedEntraId], (old) =>
        old?.filter((c) => c.id !== confirmChat?.id)
      )
    },
  })

  return (
    <div>
      <PageHeader title="Teams Chat Cleanup" subtitle="Super Admin only — delete user Teams chats via Microsoft Graph" />

      <Card className="mb-4">
        <div className="flex gap-3 items-end">
          <div className="flex-1">
            <label className="text-sm font-medium text-gray-700 mb-1 block">Employee</label>
            <select
              className="w-full border rounded-lg px-3 py-2"
              value={selectedEntraId}
              onChange={(e) => setSelectedEntraId(e.target.value)}
            >
              <option value="">Select employee...</option>
              {employees.map((e) => (
                <option key={e.id} value={e.entraId}>
                  {e.name} ({e.employeeCode}) — {e.email}
                </option>
              ))}
            </select>
          </div>
          <button
            className="bg-blue-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 disabled:opacity-50"
            disabled={!selectedEntraId || isFetching}
            onClick={() => refetch()}
          >
            {isFetching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            Load Chats
          </button>
        </div>
      </Card>

      {chats.length > 0 && (
        <Card>
          <div className="divide-y">
            {chats.map((chat) => (
              <div key={chat.id} className="py-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <MessageSquare className="w-5 h-5 text-gray-400 shrink-0" />
                  <div>
                    <div className="font-medium">
                      {chat.topic || chat.members.join(', ') || 'Untitled chat'}
                    </div>
                    <div className="text-xs text-gray-500 flex items-center gap-2">
                      <span className="uppercase">{chat.chatType}</span>
                      {chat.lastUpdated && (
                        <span>• Updated {format(new Date(chat.lastUpdated), 'dd MMM yyyy, HH:mm')}</span>
                      )}
                      {chat.members.length > 0 && (
                        <span className="flex items-center gap-1">
                          <Users className="w-3 h-3" /> {chat.members.length}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <button
                  className="text-red-600 hover:bg-red-50 p-2 rounded-lg"
                  onClick={() => setConfirmChat(chat)}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        </Card>
      )}

      {chats.length === 0 && selectedEntraId && !isFetching && (
        <p className="text-gray-500 text-sm">No chats loaded yet. Click "Load Chats".</p>
      )}

      {confirmChat && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 max-w-sm w-full">
            <h3 className="font-semibold text-lg mb-2">Delete this chat?</h3>
            <p className="text-sm text-gray-600 mb-4">
              "{confirmChat.topic || confirmChat.members.join(', ') || 'Untitled chat'}" will be permanently deleted from Microsoft Teams. This cannot be undone.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                className="px-4 py-2 rounded-lg border"
                onClick={() => setConfirmChat(null)}
                disabled={deleteMutation.isPending}
              >
                Cancel
              </button>
              <button
                className="px-4 py-2 rounded-lg bg-red-600 text-white flex items-center gap-2 disabled:opacity-50"
                onClick={() => deleteMutation.mutate(confirmChat.id)}
                disabled={deleteMutation.isPending}
              >
                {deleteMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
