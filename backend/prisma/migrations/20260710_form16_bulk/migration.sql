-- AlterEnum
ALTER TYPE "DocumentType" ADD VALUE IF NOT EXISTS 'FORM_16';

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "Form16BulkStatus" AS ENUM ('PENDING', 'MATCHED', 'UNMATCHED', 'CONFIRMED', 'REJECTED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- CreateTable
CREATE TABLE "Form16BulkSession" (
    "id" TEXT NOT NULL,
    "uploadedBy" TEXT NOT NULL,
    "totalFiles" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'REVIEWING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Form16BulkSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Form16BulkItem" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "employeeId" TEXT,
    "matchedName" TEXT,
    "extractedPan" TEXT,
    "matchConfidence" INTEGER,
    "matchMethod" TEXT,
    "partAFileKey" TEXT,
    "partAFileName" TEXT,
    "partBFileKey" TEXT,
    "partBFileName" TEXT,
    "mergedFileKey" TEXT,
    "mergedFileUrl" TEXT,
    "status" "Form16BulkStatus" NOT NULL DEFAULT 'PENDING',
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Form16BulkItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Form16BulkItem_sessionId_idx" ON "Form16BulkItem"("sessionId");
CREATE INDEX "Form16BulkItem_employeeId_idx" ON "Form16BulkItem"("employeeId");

-- AddForeignKey
ALTER TABLE "Form16BulkItem" ADD CONSTRAINT "Form16BulkItem_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Form16BulkSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Form16BulkItem" ADD CONSTRAINT "Form16BulkItem_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;
