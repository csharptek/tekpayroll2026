import { Router } from 'express'
import { readFile, verifySignature, mimeFromName } from '../utils/fileStorage'
import { AppError } from '../middleware/errorHandler'

export const filesRouter = Router()

// GET /api/files/:container/*key?exp=&sig=
// No auth middleware — access is controlled by HMAC-signed URL (mirrors old Azure SAS behavior).
filesRouter.get('/:container/*', async (req, res) => {
  const { container } = req.params
  const key = (req.params as any)[0] as string
  const { exp, sig } = req.query as { exp?: string; sig?: string }

  if (!verifySignature(container, key, exp || '', sig || '')) {
    throw new AppError('Invalid or expired file link', 403)
  }

  const buffer = await readFile(container, key)
  res.setHeader('Content-Type', mimeFromName(key))
  res.send(buffer)
})
