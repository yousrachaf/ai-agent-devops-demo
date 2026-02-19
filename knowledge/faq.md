# TechCorp API — Frequently Asked Questions

Answers to the most common questions from our developer community.

---

## How do I get started with the TechCorp API?

1. **Create an account** at [dashboard.techcorp.io](https://dashboard.techcorp.io)
2. **Generate an API key** under Settings → API Keys
3. **Make your first request:**

```bash
curl https://api.techcorp.io/v2/users \
  -H "Authorization: Bearer tc_test_sk_YOUR_KEY"
```

Use a **test key** (`tc_test_sk_`) while developing — it hits a sandbox with no
real data and no billing.

---

## What is the difference between live and test API keys?

| | Test Key | Live Key |
|-|----------|---------- |
| Prefix | `tc_test_sk_` | `tc_live_sk_` |
| Data | Sandbox (fake) | Real production data |
| Billing | Not charged | Charged per your plan |
| Webhooks | Delivered to test endpoints | Delivered to configured endpoints |

Always use test keys during development and switch to live keys only when
deploying to production.

---

## How do I handle pagination?

The API uses page-based pagination. Use the `page` and `limit` parameters:

```javascript
async function getAllUsers() {
  const allUsers = [];
  let page = 1;
  let totalPages;

  do {
    const response = await client.users.list({ page, limit: 100 });
    allUsers.push(...response.data);
    totalPages = response.pagination.pages;
    page++;
  } while (page <= totalPages);

  return allUsers;
}
```

The maximum `limit` is 100 per page.

---

## Why am I getting 401 Unauthorized errors?

Common causes:

1. **Missing `Authorization` header** — The header must be `Authorization: Bearer YOUR_KEY`
2. **Using a revoked key** — Check your dashboard for active keys
3. **Wrong environment** — Test keys (`tc_test_sk_`) don't work on the production API
4. **Typo in the key** — Keys are case-sensitive; copy-paste directly from the dashboard
5. **Readonly key on a write endpoint** — `tc_ro_sk_` keys only work on GET endpoints

---

## How do rate limits work and how do I avoid hitting them?

Rate limits are enforced per API key, per minute. Check the response headers after
every request:

```
X-RateLimit-Remaining: 12
X-RateLimit-Reset: 1700000060
```

Best practices to stay within limits:

- **Cache responses** — Don't re-fetch data that hasn't changed
- **Use webhooks** — For real-time updates instead of polling
- **Batch requests** — Use list endpoints rather than fetching one resource at a time
- **Implement retry with backoff** — On `429`, wait until `X-RateLimit-Reset`
- **Upgrade your plan** — If you consistently hit limits in production

---

## Can I delete a user and recreate them with the same email?

Yes, but with a 24-hour delay. When you delete a user:

1. The user is **soft-deleted** immediately (status becomes `deleted`)
2. Their email is **reserved** for 24 hours
3. After 24 hours, the email is released and can be used for a new user

If you need to recreate immediately, contact support — they can manually release
the email reservation.

---

## How do I test webhooks locally during development?

Use a tool like [ngrok](https://ngrok.com) or [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/) to expose your local server:

```bash
# With ngrok
ngrok http 3000
# → https://abc123.ngrok.io

# Register the tunnel URL as your webhook endpoint
curl -X POST https://api.techcorp.io/v2/webhooks \
  -H "Authorization: Bearer tc_test_sk_YOUR_KEY" \
  -d '{"url": "https://abc123.ngrok.io/webhooks", "events": ["order.created"]}'
```

You can also replay webhook events from the dashboard without triggering real orders.

---

## What happens when I send duplicate requests?

The TechCorp API is idempotent for `PUT` and `DELETE` operations. For `POST`
operations (creating resources), you should use the `Idempotency-Key` header:

```http
POST /v2/orders
Idempotency-Key: order-session-12345-attempt-1
```

If you send the same `Idempotency-Key` within 24 hours, the API returns the
original response without creating a duplicate. This is critical for handling
network timeouts safely.

---

## How do I filter orders by user?

Use the `user_id` query parameter on the orders endpoint:

```http
GET /v2/orders?user_id=usr_abc123&status=shipped
```

**Note:** The old endpoint `GET /v2/users/{id}/orders` was deprecated in v2.0.2
and will be removed in v2.1.0. Migrate to the query parameter approach.

---

## What currencies are supported?

The API accepts any valid **ISO 4217** currency code. The most commonly used:

| Code | Currency |
|------|----------|
| USD | US Dollar |
| EUR | Euro |
| GBP | British Pound |
| CAD | Canadian Dollar |
| AUD | Australian Dollar |
| JPY | Japanese Yen |
| CHF | Swiss Franc |

Prices are stored and returned in the smallest unit of the currency
(cents for USD/EUR, pence for GBP, etc.) **internally**, but the API
accepts and returns decimal values for convenience.

---

## How do I migrate from v1 to v2?

Key breaking changes in v2:

1. **New base URL**: `https://api.techcorp.io/v2` (was `/v1`)
2. **Authentication**: Bearer token in header (was `?api_key=` query param)
3. **Pagination**: Page-based (was cursor-based)

Full migration guide: [docs.techcorp.io/migration/v1-to-v2](https://docs.techcorp.io/migration/v1-to-v2)

v1 is supported until **2025-06-01**. After that date, all v1 requests will
return a `410 Gone` response.
