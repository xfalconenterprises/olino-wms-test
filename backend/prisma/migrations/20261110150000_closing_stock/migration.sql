-- CreateTable
CREATE TABLE "closing_stocks" (
    "year_id" TEXT NOT NULL,
    "total_value" DECIMAL(16,2) NOT NULL,
    "data" JSONB NOT NULL,
    "saved_by_id" TEXT NOT NULL,
    "saved_by_name" TEXT NOT NULL,
    "saved_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "closing_stocks_pkey" PRIMARY KEY ("year_id")
);

-- AddForeignKey
ALTER TABLE "closing_stocks" ADD CONSTRAINT "closing_stocks_year_id_fkey" FOREIGN KEY ("year_id") REFERENCES "stock_years"("id") ON DELETE CASCADE ON UPDATE CASCADE;
