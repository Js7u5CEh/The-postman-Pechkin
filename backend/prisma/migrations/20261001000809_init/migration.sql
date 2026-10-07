-- CreateEnum
CREATE TYPE "public"."Channel" AS ENUM ('TELEGRAM', 'MAX', 'WHATSAPP');

-- CreateEnum
CREATE TYPE "public"."MessageDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "public"."MessageKind" AS ENUM ('SERVICE', 'MARKETING');

-- CreateEnum
CREATE TYPE "public"."MessageStatus" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'FAILED', 'SKIPPED_NO_CONSENT');

-- CreateEnum
CREATE TYPE "public"."CampaignStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'RUNNING', 'PAUSED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "public"."CampaignContactStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'SKIPPED');

-- CreateTable
CREATE TABLE "public"."Contact" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "city" TEXT,
    "tags" TEXT[],
    "telegramChatId" TEXT,
    "telegramConsentAt" TIMESTAMP(3),
    "telegramConsentSource" TEXT,
    "telegramConsentVersion" TEXT,
    "telegramUnsubscribedAt" TIMESTAMP(3),
    "telegramBlockedAt" TIMESTAMP(3),
    "maxUserId" TEXT,
    "maxConsentAt" TIMESTAMP(3),
    "maxConsentSource" TEXT,
    "maxConsentVersion" TEXT,
    "maxUnsubscribedAt" TIMESTAMP(3),
    "maxBlockedAt" TIMESTAMP(3),
    "whatsappPhone" TEXT,
    "whatsappConsentAt" TIMESTAMP(3),
    "whatsappConsentSource" TEXT,
    "whatsappConsentVersion" TEXT,
    "whatsappUnsubscribedAt" TIMESTAMP(3),

    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Message" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "contactId" TEXT NOT NULL,
    "channel" "public"."Channel" NOT NULL,
    "direction" "public"."MessageDirection" NOT NULL,
    "kind" "public"."MessageKind" NOT NULL DEFAULT 'SERVICE',
    "content" TEXT NOT NULL,
    "status" "public"."MessageStatus" NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "campaignId" TEXT,
    "externalId" TEXT,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Campaign" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "name" TEXT NOT NULL,
    "channel" "public"."Channel" NOT NULL,
    "kind" "public"."MessageKind" NOT NULL DEFAULT 'MARKETING',
    "status" "public"."CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "templateContent" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."CampaignContact" (
    "campaignId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "status" "public"."CampaignContactStatus" NOT NULL DEFAULT 'PENDING',
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "CampaignContact_pkey" PRIMARY KEY ("campaignId","contactId")
);

-- CreateTable
CREATE TABLE "public"."ProcessedEvent" (
    "eventId" TEXT NOT NULL,
    "channel" "public"."Channel" NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcessedEvent_pkey" PRIMARY KEY ("eventId")
);

-- CreateTable
CREATE TABLE "public"."ErrorLog" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "channel" "public"."Channel" NOT NULL,
    "errorType" TEXT NOT NULL,
    "errorMessage" TEXT NOT NULL,
    "stackTrace" TEXT,
    "context" JSONB,

    CONSTRAINT "ErrorLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Contact_telegramChatId_key" ON "public"."Contact"("telegramChatId");

-- CreateIndex
CREATE UNIQUE INDEX "Contact_maxUserId_key" ON "public"."Contact"("maxUserId");

-- CreateIndex
CREATE UNIQUE INDEX "Contact_whatsappPhone_key" ON "public"."Contact"("whatsappPhone");

-- CreateIndex
CREATE INDEX "Contact_email_idx" ON "public"."Contact"("email");

-- CreateIndex
CREATE INDEX "Message_contactId_idx" ON "public"."Message"("contactId");

-- CreateIndex
CREATE INDEX "Message_campaignId_idx" ON "public"."Message"("campaignId");

-- CreateIndex
CREATE INDEX "Message_status_idx" ON "public"."Message"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Message_channel_externalId_key" ON "public"."Message"("channel", "externalId");

-- AddForeignKey
ALTER TABLE "public"."Message" ADD CONSTRAINT "Message_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "public"."Contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Message" ADD CONSTRAINT "Message_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "public"."Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CampaignContact" ADD CONSTRAINT "CampaignContact_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "public"."Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CampaignContact" ADD CONSTRAINT "CampaignContact_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "public"."Contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
