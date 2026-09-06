ALTER TABLE "User"
ADD COLUMN "birth_latitude" DOUBLE PRECISION,
ADD COLUMN "birth_longitude" DOUBLE PRECISION,
ADD COLUMN "birth_timezone" TEXT,
ADD COLUMN "birth_time_known" BOOLEAN NOT NULL DEFAULT true;
