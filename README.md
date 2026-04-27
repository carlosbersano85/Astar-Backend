# Astar Backend

## Mercado Pago subscriptions

Use `MERCADOPAGO_SUBSCRIPTION_MODE=checkout` for local development with localhost URLs.

Use `MERCADOPAGO_SUBSCRIPTION_MODE=preapproval` in production only when `MERCADOPAGO_SUBSCRIPTION_BACK_URL` points to a public HTTPS URL.

The `preapproval` mode is the true recurring subscription flow. The `checkout` mode is the safer fallback for local testing.