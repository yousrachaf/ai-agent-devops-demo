# TechCorp API Reference — v2.0

Welcome to the TechCorp API documentation. This REST API lets you manage users,
products, and orders programmatically. All endpoints use JSON and require HTTPS.

**Base URL:** `https://api.techcorp.io/v2`

**API Version:** 2.0.3 (released 2024-11-01)

---

## Authentication

TechCorp API uses API keys for authentication. Every request must include your
API key in the `Authorization` header.

### Getting an API Key

1. Log in to the [TechCorp Dashboard](https://dashboard.techcorp.io)
2. Go to **Settings → API Keys**
3. Click **Generate New Key**
4. Copy the key — it is shown only once

### Using Your API Key

```http
GET /v2/users
Authorization: Bearer tc_live_sk_1234567890abcdef
Content-Type: application/json
```

### Key Types

| Type | Prefix | Scope |
|------|--------|-------|
| Live key | `tc_live_sk_` | Full access — use in production |
| Test key | `tc_test_sk_` | Sandbox only — no real data |
| Readonly key | `tc_ro_sk_` | GET requests only |

### Rotating API Keys

To rotate a key without downtime:
1. Generate a new key in the dashboard
2. Deploy your updated configuration
3. Invalidate the old key in the dashboard

Old keys remain valid for 24 hours after a new key of the same type is generated,
giving you time to complete the rotation.

---

## Rate Limits

The TechCorp API enforces rate limits to ensure fair usage across all customers.

### Default Limits

| Plan | Requests/minute | Requests/day |
|------|----------------|--------------|
| Free | 60 | 10,000 |
| Starter | 300 | 100,000 |
| Pro | 1,000 | 1,000,000 |
| Enterprise | Custom | Custom |

### Rate Limit Headers

Every response includes headers that show your current usage:

```http
X-RateLimit-Limit: 300
X-RateLimit-Remaining: 287
X-RateLimit-Reset: 1700000060
X-RateLimit-Window: 60
```

- `X-RateLimit-Reset` is a Unix timestamp (seconds) when the window resets
- When `X-RateLimit-Remaining` reaches 0, subsequent requests return `429 Too Many Requests`

### Handling Rate Limits

```javascript
async function apiRequest(url, options, retries = 3) {
  const response = await fetch(url, options);

  if (response.status === 429) {
    const resetAt = parseInt(response.headers.get('X-RateLimit-Reset'), 10);
    const waitMs = (resetAt * 1000) - Date.now() + 100; // +100ms buffer
    await new Promise(resolve => setTimeout(resolve, waitMs));
    return apiRequest(url, options, retries - 1);
  }

  return response;
}
```

---

## Users

### List Users

```http
GET /v2/users
```

**Query Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `page` | integer | 1 | Page number (1-indexed) |
| `limit` | integer | 20 | Results per page (max: 100) |
| `status` | string | all | Filter: `active`, `inactive`, `pending` |
| `sort` | string | created_at | Sort field |
| `order` | string | desc | Sort direction: `asc`, `desc` |

**Response:**

```json
{
  "data": [
    {
      "id": "usr_abc123",
      "email": "alice@example.com",
      "name": "Alice Martin",
      "status": "active",
      "plan": "pro",
      "created_at": "2024-01-15T10:30:00Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 142,
    "pages": 8
  }
}
```

### Get a User

```http
GET /v2/users/{user_id}
```

Returns a single user object. Returns `404` if the user does not exist.

### Create a User

```http
POST /v2/users
Content-Type: application/json

{
  "email": "bob@example.com",
  "name": "Bob Dupont",
  "plan": "starter",
  "metadata": {
    "company": "Acme Corp",
    "source": "referral"
  }
}
```

**Validation rules:**
- `email` — required, valid format, unique in your account
- `name` — required, 2–100 characters
- `plan` — optional, defaults to `free`
- `metadata` — optional, max 10 key-value pairs, keys max 40 chars

### Update a User

```http
PATCH /v2/users/{user_id}
Content-Type: application/json

{
  "name": "Robert Dupont",
  "status": "inactive"
}
```

Only include fields you want to change. `email` cannot be updated — create a
new user instead.

### Delete a User

```http
DELETE /v2/users/{user_id}
```

Soft-deletes the user. Their data is retained for 30 days before permanent deletion.
Returns `204 No Content` on success.

---

## Products

### List Products

```http
GET /v2/products
```

**Query Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `category` | string | Filter by category slug |
| `in_stock` | boolean | Filter by stock availability |
| `min_price` | number | Minimum price (inclusive) |
| `max_price` | number | Maximum price (inclusive) |
| `q` | string | Full-text search in name and description |

**Response:**

```json
{
  "data": [
    {
      "id": "prd_xyz789",
      "name": "Pro Widget",
      "sku": "WGT-PRO-001",
      "price": 49.99,
      "currency": "USD",
      "category": "widgets",
      "stock": 142,
      "status": "active",
      "created_at": "2024-03-01T00:00:00Z"
    }
  ]
}
```

### Create a Product

```http
POST /v2/products
Content-Type: application/json

{
  "name": "Standard Widget",
  "sku": "WGT-STD-001",
  "price": 19.99,
  "currency": "USD",
  "category": "widgets",
  "stock": 500,
  "description": "Our most popular widget for everyday use."
}
```

**Validation:**
- `sku` must be unique across your catalog
- `price` must be positive
- `currency` must be a valid ISO 4217 code (USD, EUR, GBP, etc.)

### Update Product Stock

```http
POST /v2/products/{product_id}/stock
Content-Type: application/json

{
  "operation": "add",
  "quantity": 100,
  "reason": "restocking"
}
```

`operation` can be `add`, `subtract`, or `set`. Stock cannot go below 0 with
`subtract` — the API returns a `422` error if it would.

---

## Orders

### Create an Order

```http
POST /v2/orders
Content-Type: application/json

{
  "user_id": "usr_abc123",
  "items": [
    { "product_id": "prd_xyz789", "quantity": 2 }
  ],
  "shipping_address": {
    "line1": "123 Main Street",
    "city": "Paris",
    "postal_code": "75001",
    "country": "FR"
  },
  "currency": "EUR"
}
```

**Response:**

```json
{
  "id": "ord_def456",
  "status": "pending",
  "user_id": "usr_abc123",
  "total": 89.98,
  "currency": "EUR",
  "items": [...],
  "created_at": "2024-11-01T14:22:00Z"
}
```

### Order Statuses

| Status | Description |
|--------|-------------|
| `pending` | Order received, payment not yet confirmed |
| `confirmed` | Payment confirmed, awaiting fulfillment |
| `processing` | Order is being picked and packed |
| `shipped` | Order dispatched — tracking available |
| `delivered` | Confirmed delivery |
| `cancelled` | Order cancelled — refund issued if applicable |

### Cancel an Order

```http
POST /v2/orders/{order_id}/cancel

{
  "reason": "customer_request"
}
```

Orders can only be cancelled while in `pending` or `confirmed` status.
Once `processing` has started, contact support.

---

## Webhooks

### Overview

Webhooks allow TechCorp to push events to your server in real-time, instead of
you polling for changes.

### Configuring Webhooks

```http
POST /v2/webhooks
Content-Type: application/json

{
  "url": "https://your-server.com/webhooks/techcorp",
  "events": ["order.created", "order.shipped", "user.deleted"],
  "secret": "whsec_your_signing_secret"
}
```

### Available Events

| Event | Triggered When |
|-------|----------------|
| `user.created` | New user is created |
| `user.deleted` | User is deleted |
| `order.created` | New order is placed |
| `order.status_changed` | Order status transitions |
| `order.shipped` | Tracking number assigned |
| `product.out_of_stock` | Stock reaches 0 |
| `payment.failed` | Payment attempt fails |

### Verifying Webhook Signatures

Every webhook request includes a signature in the `X-TechCorp-Signature` header.
**Always verify this signature** before processing the payload.

```javascript
const crypto = require('crypto');

function verifyWebhook(rawBody, signature, secret) {
  const expected = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(`sha256=${expected}`)
  );
}
```

### Retry Policy

If your endpoint returns a non-2xx status or doesn't respond within 10 seconds,
TechCorp retries with exponential backoff:

| Attempt | Delay |
|---------|-------|
| 1st retry | 1 minute |
| 2nd retry | 5 minutes |
| 3rd retry | 30 minutes |
| 4th retry | 2 hours |
| 5th retry | 8 hours |

After 5 failed attempts, the event is marked as failed and no further retries
occur. You can manually replay failed events from the dashboard.

---

## Error Codes

All errors follow a consistent structure:

```json
{
  "error": {
    "code": "RESOURCE_NOT_FOUND",
    "message": "User usr_abc123 does not exist",
    "param": "user_id",
    "request_id": "req_9f3a2b1c"
  }
}
```

### HTTP Status Codes

| Status | Code | Meaning |
|--------|------|---------|
| 400 | `INVALID_REQUEST` | Missing or invalid parameter |
| 401 | `UNAUTHORIZED` | Invalid or missing API key |
| 403 | `FORBIDDEN` | API key lacks permission for this operation |
| 404 | `RESOURCE_NOT_FOUND` | The requested resource does not exist |
| 409 | `CONFLICT` | Duplicate resource (e.g., duplicate SKU) |
| 422 | `UNPROCESSABLE` | Request is well-formed but invalid (e.g., stock < 0) |
| 429 | `RATE_LIMITED` | Too many requests — see Rate Limits |
| 500 | `INTERNAL_ERROR` | TechCorp server error — retry with backoff |
| 503 | `SERVICE_UNAVAILABLE` | API is temporarily down for maintenance |

### Common Error Codes

| Code | Resolution |
|------|-----------|
| `MISSING_REQUIRED_FIELD` | Add the required field to your request body |
| `INVALID_EMAIL` | Ensure email follows RFC 5321 format |
| `SKU_ALREADY_EXISTS` | Use a unique SKU for each product |
| `INSUFFICIENT_STOCK` | Check current stock before subtracting |
| `INVALID_CURRENCY` | Use a valid ISO 4217 currency code |
| `ORDER_NOT_CANCELLABLE` | Order is past the cancellable status |

---

## SDKs & Libraries

Official TechCorp SDK packages:

| Language | Package | Install |
|----------|---------|---------|
| Node.js | `@techcorp/sdk` | `npm install @techcorp/sdk` |
| Python | `techcorp-sdk` | `pip install techcorp-sdk` |
| PHP | `techcorp/sdk` | `composer require techcorp/sdk` |
| Ruby | `techcorp` | `gem install techcorp` |
| Go | `github.com/techcorp/go-sdk` | `go get github.com/techcorp/go-sdk` |

### Node.js Quick Start

```javascript
const TechCorp = require('@techcorp/sdk');

const client = new TechCorp({ apiKey: process.env.TECHCORP_API_KEY });

// List users
const users = await client.users.list({ status: 'active', limit: 10 });

// Create an order
const order = await client.orders.create({
  userId: 'usr_abc123',
  items: [{ productId: 'prd_xyz789', quantity: 1 }],
});

console.log(`Order created: ${order.id}`);
```

---

## Changelog

### v2.0.3 (2024-11-01)
- Added `metadata` field to users
- Increased webhook retry from 3 to 5 attempts
- Fixed `X-RateLimit-Reset` header to use Unix seconds (not milliseconds)

### v2.0.2 (2024-09-15)
- Added `product.out_of_stock` webhook event
- Added `readonly` API key type
- Deprecated `GET /v2/users/{id}/orders` — use `GET /v2/orders?user_id={id}` instead

### v2.0.0 (2024-06-01)
- New versioned base URL (`/v2`)
- Bearer token authentication replaces query-string API keys
- Cursor-based pagination replaced with page-based
- Full changelog: [migration guide](https://docs.techcorp.io/migration/v1-to-v2)
