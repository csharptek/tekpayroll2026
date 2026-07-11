-- Staging binary columns
ALTER TABLE "Form16BulkItem" ADD COLUMN IF NOT EXISTS "partAData" BYTEA;
ALTER TABLE "Form16BulkItem" ADD COLUMN IF NOT EXISTS "partBData" BYTEA;

-- StoredFile table
CREATE TABLE IF NOT EXISTS "StoredFile" (
    "id" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL DEFAULT 'application/pdf',
    "data" BYTEA NOT NULL,
    "size" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StoredFile_pkey" PRIMARY KEY ("id")
);
