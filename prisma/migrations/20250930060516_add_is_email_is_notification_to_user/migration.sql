-- AlterTable
ALTER TABLE "public"."users" ADD COLUMN     "isEmail" BOOLEAN DEFAULT true,
ADD COLUMN     "isNotification" BOOLEAN DEFAULT true;
