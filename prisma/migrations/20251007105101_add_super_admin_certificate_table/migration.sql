-- CreateTable
CREATE TABLE "public"."super_admin_certificates" (
    "id" TEXT NOT NULL,
    "propertyTypeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "validityMonths" INTEGER NOT NULL DEFAULT 12,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "super_admin_certificates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "super_admin_certificates_propertyTypeId_isActive_key" ON "public"."super_admin_certificates"("propertyTypeId", "isActive");

-- AddForeignKey
ALTER TABLE "public"."super_admin_certificates" ADD CONSTRAINT "super_admin_certificates_propertyTypeId_fkey" FOREIGN KEY ("propertyTypeId") REFERENCES "public"."property_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."super_admin_certificates" ADD CONSTRAINT "super_admin_certificates_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
