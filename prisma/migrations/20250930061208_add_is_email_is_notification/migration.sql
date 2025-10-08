/*
  Warnings:

  - Made the column `isEmail` on table `users` required. This step will fail if there are existing NULL values in that column.
  - Made the column `isNotification` on table `users` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "public"."users" ALTER COLUMN "isEmail" SET NOT NULL,
ALTER COLUMN "isNotification" SET NOT NULL;
