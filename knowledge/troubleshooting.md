# TechCorp API — Troubleshooting Guide

Step-by-step solutions for the most common integration problems.

---

## Problem 1: Requests randomly fail with 500 Internal Server Error

**Symptoms:**
- Most requests succeed, but ~2–5% return `500` with no helpful error message
- Failures are not reproducible — the same request works on retry
- The `request_id` in the error response is different each time

**Root Cause:**
Transient server-side errors occur during deployments, database failovers, or
unexpected traffic spikes. These are temporary and not caused by your code.

**Solution:**

Implement exponential backoff with jitter for all write operations:

```javascript
async function reliablePost(url, body, { maxRetries = 3 } = {}) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${API_KEY}` },
        body: JSON.stringify(body),
      });

      if (response.status >= 500 && attempt < maxRetries) {
        // Jitter prevents thundering herd when all clients retry simultaneously
        const delay = Math.pow(2, attempt) * 1000 + Math.random() * 500;
        await new Promise(r => setTimeout(r, delay));
        continue;
      }

      return response;
    } catch (networkError) {
      if (attempt === maxRetries) throw networkError;
    }
  }
}
```

**When to escalate:** If you see sustained 500 errors (> 5 minutes), check
[status.techcorp.io](https://status.techcorp.io) and contact support with the
`request_id` values from the failed responses.

---

## Problem 2: Webhooks are not being delivered to my endpoint

**Symptoms:**
- Events are visible in the TechCorp dashboard but your endpoint never receives them
- No error logs on your server
- The webhook status in the dashboard shows "Failed"

**Diagnostic Checklist:**

1. **Check your endpoint is publicly reachable:**
   ```bash
   curl -X POST https://your-server.com/webhooks/techcorp \
     -H "Content-Type: application/json" \
     -d '{"test": true}'
   ```
   If this fails, your server is not accessible from the internet.

2. **Verify your endpoint returns 2xx within 10 seconds:**
   TechCorp marks a delivery as failed if the response takes > 10 seconds.
   Your handler must acknowledge quickly and process asynchronously:
   ```javascript
   app.post('/webhooks/techcorp', (req, res) => {
     res.sendStatus(200); // Acknowledge immediately
     processWebhookAsync(req.body); // Process in background
   });
   ```

3. **Check your firewall allows TechCorp's IP ranges:**
   Inbound requests come from: `52.18.0.0/16`, `34.200.0.0/16`

4. **Verify webhook signature validation is not rejecting requests:**
   Temporarily log the raw body and signature to debug validation code.

**Replaying Failed Webhooks:**
In the dashboard → Webhooks → select your endpoint → Failed Events → Replay

---

## Problem 3: "SKU_ALREADY_EXISTS" error when creating products

**Symptoms:**
- `POST /v2/products` returns `409 Conflict` with code `SKU_ALREADY_EXISTS`
- You believe the SKU should not exist
- This happens even after deleting the product

**Root Cause:**
Product deletion is soft — deleted products still reserve their SKU for 30 days
to prevent order history corruption (old orders reference the SKU).

**Solutions:**

**Option A — Use a new SKU:**
```javascript
// Append a version suffix to avoid conflicts
const sku = `WGT-PRO-001-v2`; // Instead of WGT-PRO-001
```

**Option B — Reactivate the deleted product:**
```http
PATCH /v2/products/{product_id}
{ "status": "active", "stock": 100 }
```

**Option C — Wait 30 days** for the SKU to be released automatically.

**Option D — Contact support** to release the SKU immediately (requires justification).

**Prevention:**
Use unique, versioned SKUs in your import pipeline. Never reuse a SKU for a
different physical product — order history becomes inaccurate.

---

## Problem 4: Orders stuck in "pending" status

**Symptoms:**
- Orders are created successfully but never transition to `confirmed`
- The user's payment method is charged
- Hours pass with no status change

**Diagnostic Steps:**

1. **Check payment processor status:**
   Payment confirmations can be delayed during high traffic. Check your payment
   processor's dashboard for pending transactions.

2. **Query the order for details:**
   ```http
   GET /v2/orders/{order_id}
   ```
   Look for the `payment_status` field and `events` array — they show what
   happened and when.

3. **Check webhook delivery:**
   If you rely on the `order.status_changed` webhook to update your UI, verify
   the webhook was delivered (see Problem 2 above).

4. **Verify your payment integration:**
   If you use a custom payment flow, ensure you're calling `POST /v2/orders/{id}/confirm`
   after receiving payment confirmation from your processor.

**Manual Confirmation (for testing only):**
```http
POST /v2/orders/{order_id}/confirm
Authorization: Bearer tc_test_sk_YOUR_KEY
```
This only works with test keys — live orders must go through the payment flow.

---

## Problem 5: API responses are very slow (> 2 seconds)

**Symptoms:**
- Most requests complete in < 200ms, but some take 2–5 seconds
- Slow requests often involve list endpoints with no filters
- Performance degrades as your data grows

**Root Cause:**
Unfiltered list queries scan large datasets. As your catalog or user base grows,
queries without filters become progressively slower.

**Solutions:**

**Always use specific filters:**
```javascript
// SLOW — scans all orders
const orders = await client.orders.list({ limit: 100 });

// FAST — uses indexed filter
const orders = await client.orders.list({
  user_id: 'usr_abc123',
  status: 'shipped',
  limit: 20
});
```

**Use field selection to reduce payload size:**
```http
GET /v2/users?fields=id,email,status
```

**Cache frequently-read, rarely-changed data:**
```javascript
const cache = new Map();

async function getProduct(id) {
  if (cache.has(id)) return cache.get(id);
  const product = await client.products.get(id);
  cache.set(id, product);
  setTimeout(() => cache.delete(id), 5 * 60 * 1000); // 5-minute TTL
  return product;
}
```

**Use webhooks instead of polling:**
Instead of fetching order status every 30 seconds, subscribe to
`order.status_changed` events — you get notified immediately with zero polling overhead.

**Still slow after optimisation?**
Include your `request_id` values when contacting support — our team can analyse
the query plan and add a database index if needed.
