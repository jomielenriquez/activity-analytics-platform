-- CreateEnum
CREATE TYPE "segment_type" AS ENUM ('active', 'idle');

-- CreateTable
CREATE TABLE "devices" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "device_name" TEXT NOT NULL,
    "os" TEXT NOT NULL,
    "user_identifier" TEXT NOT NULL,
    "api_key_hash" TEXT NOT NULL,
    "agent_status" TEXT NOT NULL DEFAULT 'running',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(6),

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_segments" (
    "id" BIGSERIAL NOT NULL,
    "device_id" UUID NOT NULL,
    "client_segment_id" UUID NOT NULL,
    "type" "segment_type" NOT NULL,
    "app_name" TEXT,
    "window_title" TEXT,
    "started_at" TIMESTAMPTZ(6) NOT NULL,
    "ended_at" TIMESTAMPTZ(6) NOT NULL,
    "duration_seconds" INTEGER NOT NULL,
    "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_segments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_segments_device_time" ON "activity_segments"("device_id", "started_at");

-- CreateIndex
CREATE INDEX "idx_segments_app" ON "activity_segments"("app_name");

-- CreateIndex
CREATE UNIQUE INDEX "activity_segments_device_id_client_segment_id_key" ON "activity_segments"("device_id", "client_segment_id");

-- AddForeignKey
ALTER TABLE "activity_segments" ADD CONSTRAINT "activity_segments_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
