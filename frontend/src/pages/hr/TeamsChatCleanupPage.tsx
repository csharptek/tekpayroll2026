import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { MessageSquare, Trash2, Loader2, Users, Search, X } from 'lucide-react'
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

interface Message {
  id: string
  from: string
  createdDateTime: string
  contentType: string
  content: string
}

export default function TeamsChatCleanupPage() {
  const [selectedEntraId, setSelectedEntraId] = useState('')
  const [confirmChat, setConfirmChat] = useState<Chat | null>(null)
  const [chats, setChats] = useState<Chat[]>([])
  const [nextLink, setNextLink] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [viewChat, setViewChat] = useState<Chat | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [msgNextLink, setMsgNextLink] = useState<string | null>(null)
  const [msgLoading, setMsgLoading] = useState(false)
  const qc = useQueryClient()

  const { data: employees = [] } = useQuery<Employee[]>({
    queryKey: ['teams-chat-employees'],
    queryFn: async () => (await teamsChatApi.employees()).data,
  })

  const loadChats = async (reset: boolean) => {
    setLoading(true)
    try {
      const link = reset ? undefined : nextLink || undefined
      const { data } = await teamsChatApi.chats(selectedEntraId, link)
      setChats((prev) => (reset ? data.chats : [...prev, ...data.chats]))
      setNextLink(data.nextLink)
    } finally {
      setLoading(false)
    }
  }

  const openChat = async (chat: Chat) => {
    setViewChat(chat)
    setMessages([])
    setMsgNextLink(null)
    setMsgLoading(true)
    try {
      const { data } = await teamsChatApi.messages(chat.id)
      setMessages(data.messages)
      setMsgNextLink(data.nextLink)
    } finally {
      setMsgLoading(false)
    }
  }

  const loadMoreMessages = async () => {
    if (!viewChat || !msgNextLink) return
    setMsgLoading(true)
    try {
      const { data } = await teamsChatApi.messages(viewChat.id, msgNextLink)
      setMessages((prev) => [...prev, ...data.messages])
      setMsgNextLink(data.nextLink)
    } finally {
      setMsgLoading(false)
    }
  }

  const deleteMutation = useMutation({
    mutationFn: (chatId: string) => teamsChatApi.deleteChat(chatId),
    onSuccess: () => {
      setConfirmChat(null)
      setChats((prev) => prev.filter((c) => c.id !== confirmChat?.id))
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
            disabled={!selectedEntraId || loading}
            onClick={() => loadChats(true)}
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            Load Chats
          </button>
        </div>
      </Card>

      {chats.length > 0 && (
        <Card>
          <div className="divide-y">
            {chats.map((chat) => (
              <div key={chat.id} className="py-3 flex items-center justify-between">
                <div
                  className="flex items-center gap-3 cursor-pointer flex-1"
                  onClick={() => openChat(chat)}
                >
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
                  onClick={(e) => { e.stopPropagation(); setConfirmChat(chat) }}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
          {nextLink && (
            <div className="pt-3 text-center">
              <button
                className="text-blue-600 text-sm font-medium flex items-center gap-2 mx-auto disabled:opacity-50"
                onClick={() => loadChats(false)}
                disabled={loading}
              >
                {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                Load More
              </button>
            </div>
          )}
        </Card>
      )}

      {chats.length === 0 && selectedEntraId && !loading && (
        <p className="text-gray-500 text-sm">No chats loaded yet. Click "Load Chats".</p>
      )}

      {viewChat && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl w-full max-w-lg max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between p-4 border-b">
              <div>
                <h3 className="font-semibold">
                  {viewChat.topic || viewChat.members.join(', ') || 'Untitled chat'}
                </h3>
                <p className="text-xs text-gray-500 uppercase">{viewChat.chatType}</p>
              </div>
              <button onClick={() => setViewChat(null)} className="p-1 hover:bg-gray-100 rounded-lg">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {msgLoading && messages.length === 0 && (
                <div className="flex justify-center py-8">
                  <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
                </div>
              )}
              {!msgLoading && messages.length === 0 && (
                <p className="text-sm text-gray-500 text-center py-8">No messages found.</p>
              )}
              {messages.map((m) => (
                <div key={m.id} className="border rounded-lg p-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium">{m.from}</span>
                    <span className="text-xs text-gray-400">
                      {format(new Date(m.createdDateTime), 'dd MMM yyyy, HH:mm')}
                    </span>
                  </div>
                  {m.contentType === 'html' ? (
                    <div
                      className="text-sm text-gray-700 [&_img]:max-w-full"
                      dangerouslySetInnerHTML={{ __html: m.content }}
                    />
                  ) : (
                    <p className="text-sm text-gray-700 whitespace-pre-wrap">{m.content}</p>
                  )}
                </div>
              ))}
              {msgNextLink && (
                <div className="text-center pt-1">
                  <button
                    className="text-blue-600 text-sm font-medium disabled:opacity-50 flex items-center gap-2 mx-auto"
                    onClick={loadMoreMessages}
                    disabled={msgLoading}
                  >
                    {msgLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                    Load More
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
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
