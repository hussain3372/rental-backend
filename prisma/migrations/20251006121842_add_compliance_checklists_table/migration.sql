/*
  Warnings:

  - You are about to drop the column `complianceChecklist` on the `applications` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "public"."applications" DROP COLUMN "complianceChecklist";

-- CreateTable
CREATE TABLE "public"."compliance_checklists" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "checklistId" TEXT NOT NULL,
    "checked" BOOLEAN NOT NULL DEFAULT false,
    "checkedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "compliance_checklists_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "compliance_checklists_applicationId_checklistId_key" ON "public"."compliance_checklists"("applicationId", "checklistId");

-- AddForeignKey
ALTER TABLE "public"."compliance_checklists" ADD CONSTRAINT "compliance_checklists_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "public"."applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."compliance_checklists" ADD CONSTRAINT "compliance_checklists_checklistId_fkey" FOREIGN KEY ("checklistId") REFERENCES "public"."checklists"("id") ON DELETE CASCADE ON UPDATE CASCADE;
