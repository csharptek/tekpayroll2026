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
    if (!entraId) throw new AppError('entraId is required', 400);

    const token = await getGraphToken();
    let url: string | null =
      `https://graph.microsoft.com/v1.0/users/${entraId}/chats?$expand=members&$top=50`;

    const chats: any[] = [];
    while (url) {
      const r: Response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!r.ok) {
        const e = await r.json() as any;
        throw new AppError(`Graph error: ${e.error?.message || r.statusText}`, r.status);
      }
      const data = await r.json() as any;
      chats.push(...data.value);
      url = data['@odata.nextLink'] || null;
    }

    const formatted = chats.map((c) => ({
      id: c.id,
      topic: c.topic || null,
      chatType: c.chatType,
      lastUpdated: c.lastUpdatedDateTime,
      members: (c.members || []).map((m: any) => m.displayName).filter(Boolean),
    }));

    res.json(formatted);
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
