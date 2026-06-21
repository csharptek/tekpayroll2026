import { Router } from 'express';
import { authenticate, requireSuperAdmin } from '../middleware/auth';
import { prisma } from '../utils/prisma';
import { AppError } from '../middleware/errorHandler';
import { getGraphToken } from '../services/graphSyncService';

export const teamsChatRouter = Router();
teamsChatRouter.use(authenticate, requireSuperAdmin);

// ─── EMPLOYEES WITH ENTRA ID (for dropdown) ──────────────────────────────────

teamsChatRouter.get('/employees', async (req, res, next) => {
  try {
    const employees = await prisma.employee.findMany({
      where: { entraId: { not: null } },
      select: { id: true, name: true, email: true, employeeCode: true, entraId: true },
      orderBy: { name: 'asc' },
    });
    res.json(employees);
  } catch (e) { next(e); }
});

// ─── LIST CHATS FOR A USER ───────────────────────────────────────────────────

teamsChatRouter.get('/chats', async (req, res, next) => {
  try {
    const entraId = req.query.entraId as string;
    const nextLink = req.query.nextLink as string | undefined;
    if (!entraId) throw new AppError('entraId is required', 400);

    const token = await getGraphToken();
    const url = nextLink ||
      `https://graph.microsoft.com/v1.0/users/${entraId}/chats?$expand=members&$top=10`;

    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) {
      const e = await r.json() as any;
      throw new AppError(`Graph error: ${e.error?.message || r.statusText}`, r.status);
    }
    const data = await r.json() as any;

    const chats = (data.value || []).map((c: any) => ({
      id: c.id,
      topic: c.topic || null,
      chatType: c.chatType,
      lastUpdated: c.lastUpdatedDateTime,
      members: (c.members || []).map((m: any) => m.displayName).filter(Boolean),
    }));

    res.json({ chats, nextLink: data['@odata.nextLink'] || null });
  } catch (e) { next(e); }
});

// ─── LIST MESSAGES IN A CHAT ─────────────────────────────────────────────────

teamsChatRouter.get('/chats/:chatId/messages', async (req, res, next) => {
  try {
    const { chatId } = req.params;
    const nextLink = req.query.nextLink as string | undefined;
    const token = await getGraphToken();

    const url = nextLink ||
      `https://graph.microsoft.com/v1.0/chats/${chatId}/messages?$top=50`;

    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) {
      const e = await r.json() as any;
      throw new AppError(`Graph error: ${e.error?.message || r.statusText}`, r.status);
    }
    const data = await r.json() as any;

    const messages = (data.value || [])
      .filter((m: any) => m.messageType === 'message' && m.body?.content)
      .map((m: any) => ({
        id: m.id,
        from: m.from?.user?.displayName || m.from?.application?.displayName || 'Unknown',
        createdDateTime: m.createdDateTime,
        contentType: m.body?.contentType,
        content: m.body?.content,
      }));

    res.json({ messages, nextLink: data['@odata.nextLink'] || null });
  } catch (e) { next(e); }
});

// ─── DELETE A CHAT ────────────────────────────────────────────────────────────

teamsChatRouter.delete('/chats/:chatId', async (req, res, next) => {
  try {
    const { chatId } = req.params;
    const token = await getGraphToken();

    const r = await fetch(`https://graph.microsoft.com/v1.0/chats/${chatId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!r.ok && r.status !== 204) {
      const e = await r.json() as any;
      throw new AppError(`Graph delete failed: ${e.error?.message || r.statusText}`, r.status);
    }

    res.json({ success: true });
  } catch (e) { next(e); }
});
