-- AlterTable
ALTER TABLE "Menfes" ADD COLUMN     "igCaption" TEXT,
ADD COLUMN     "igError" TEXT,
ADD COLUMN     "igImageUrl" TEXT,
ADD COLUMN     "igMediaId" TEXT,
ADD COLUMN     "igPermalink" TEXT,
ADD COLUMN     "igPublishedAt" TIMESTAMP(3),
ADD COLUMN     "igStatus" TEXT;

-- CreateIndex
CREATE INDEX "Menfes_igStatus_idx" ON "Menfes"("igStatus");
