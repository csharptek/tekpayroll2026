-- Add RELIEVING_LETTER to DocumentType enum
ALTER TYPE "DocumentType" ADD VALUE IF NOT EXISTS 'RELIEVING_LETTER';

-- Add new columns to EmployeeDocument
ALTER TABLE "EmployeeDocument"
  ADD COLUMN IF NOT EXISTS "referenceNumber" TEXT,
  ADD COLUMN IF NOT EXISTS "isLocked"        BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "uploadedByRole"  TEXT;
