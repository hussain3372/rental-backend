/*
  Warnings:

  - You are about to drop the column `applicationId` on the `checklists` table. All the data in the column will be lost.
  - Added the required column `propertyTypeId` to the `checklists` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "public"."checklists" DROP CONSTRAINT "checklists_applicationId_fkey";

-- AlterTable
ALTER TABLE "public"."checklists" DROP COLUMN "applicationId",
ADD COLUMN     "propertyTypeId" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "public"."property_types" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "property_types_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "property_types_name_key" ON "public"."property_types"("name");

-- AddForeignKey
ALTER TABLE "public"."checklists" ADD CONSTRAINT "checklists_propertyTypeId_fkey" FOREIGN KEY ("propertyTypeId") REFERENCES "public"."property_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;
