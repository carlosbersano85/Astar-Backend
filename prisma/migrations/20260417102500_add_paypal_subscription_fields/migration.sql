-- Add PayPal subscription state to users
ALTER TABLE "User"
ADD COLUMN "paypal_subscription_id" TEXT,
ADD COLUMN "paypal_plan" TEXT,
ADD COLUMN "paypal_billing_cycle" TEXT;
