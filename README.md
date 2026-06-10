<div align="center">

# ⚡ VectorX Shield

### Redis-Powered Caching · Rate Limiting · Wildcard Invalidation for Express.js

[![npm version](https://img.shields.io/badge/version-1.1.0-blueviolet?style=for-the-badge)](https://www.npmjs.com/)
[![license](https://img.shields.io/badge/license-MIT-brightgreen?style=for-the-badge)](LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D18.0.0-blue?style=for-the-badge&logo=node.js)](https://nodejs.org/)
[![redis](https://img.shields.io/badge/Redis-Compatible-red?style=for-the-badge&logo=redis)](https://redis.io/)

**Drop-in Express middleware that caches API responses, enforces per-IP rate limits, and supports wildcard cache invalidation — all backed by Redis with zero-config fail-safe protection.**

</div>

---

## 🚀 Benchmark Results

Real benchmarks from live test runs:

### Caching

| Request | Cache Status | Response Time | Speedup |
|---|---|---|---|
| 1st hit | 📭 MISS — DB query runs | `2013ms` | baseline |
| 2nd hit | ⚡ HIT — served from cache | `4ms` | **99.8% faster** |

### Rate Limiting  *(limit: 3 req / 10s)*

| Request # | Count | HTTP Status |
|---|---|---|
| 1 | 1/3 | `200 OK` ✅ |
| 2 | 2/3 | `200 OK` ✅ |
| 3 | 3/3 | `200 OK` ✅ |
| 4 | 4/3 | `429 Too Many Requests` 🚫 |
| 5+ | 5/3+ | `429 Too Many Requests` 🚫 |

### Wildcard Invalidation

| Action | Result |
|---|---|
| Cache hit before clear | `3ms` (instant from cache) |
| `POST /api/clear-all` with `/api/*` | `1 key(s) cleared` ✅ |
| Next request after clear | `2004ms` (DB hit — cache was wiped) |

---

## ✨ Features

### ⚡ Automatic Response Caching
Intercepts outgoing `200` responses and stores them in Redis with a configurable TTL. Every subsequent request for the same route is served instantly — your database never gets hit twice for the same data.

### 🚦 Per-IP Rate Limiting
Track each visitor by IP address with a sliding window counter in Redis. Requests beyond the limit receive an immediate `429 Too Many Requests` with `retryAfter` and standard `X-RateLimit-*` headers — no external library needed.

### 🗑️ Smart Cache Invalidation with Wildcard Support
Call `shield.invalidate(pattern)` with an exact route or a `*` wildcard to clear one or many cache keys at once. Logs exactly how many keys were wiped.

### 🛡️ Fail-Safe Fallback
No Redis? No problem. VectorX Shield detects connection failures and silently falls back to pass-through mode. **Your API never breaks** — it just runs without caching or rate limiting until Redis comes back online.

### 🧠 Built-in Mock Store
Zero-dependency in-memory store for local development and testing — full TTL support, wildcard key scanning, and atomic counters. Identical API to the real Redis client.

### 🔑 Smart Cache Keys
Cache keys are scoped by `HTTP method + URL path`, so `GET /api/users` and `POST /api/users` never collide.

---

## 📦 Installation

```bash
npm install vectorx-shield redis express
```

> **Requirements:** Node.js ≥ 18, Redis ≥ 6 (optional — fail-safe activates automatically without it)

---

## 🛠️ Quick Start

```js
const express = require('express');
const VectorXShield = require('vectorx-shield');

const app = express();
app.use(express.json());

const shield = new VectorXShield({ url: 'redis://localhost:6379' });

// Cache route for 60 seconds
app.get('/api/products', shield.cache(60), async (req, res) => {
  const products = await db.query('SELECT * FROM products');
  res.json({ status: 'success', data: products });
});

// Rate limit to 100 requests per minute per IP
app.get('/api/search', shield.rateLimit(100, 60), async (req, res) => {
  const results = await db.search(req.query.q);
  res.json({ status: 'success', data: results });
});

app.listen(3000);
```

---

## 📖 API Reference

### Initialization

```js
const VectorXShield = require('vectorx-shield');

// Production — connect to Redis
const shield = new VectorXShield({ url: 'redis://your-redis-host:6379' });

// Development — use built-in in-memory mock store (no Redis needed)
const shield = new VectorXShield({ mock: true });
```

---

### `shield.cache(ttl)` — Response Caching Middleware

Caches successful `200` JSON responses in Redis. Returns the cached payload instantly on subsequent requests.

```js
// Cache for 30 seconds
app.get('/api/heavy-data', shield.cache(30), (req, res) => {
  res.json({ data: '...' });
});

// Cache for 1 hour (default)
app.get('/api/config', shield.cache(), (req, res) => {
  res.json({ theme: 'dark', version: '2.1' });
});
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `ttl` | `number` | `3600` | Cache duration in seconds |

---

### `shield.rateLimit(maxRequests, windowInSeconds)` — IP Rate Limiter Middleware

Tracks each IP's request count per route using a Redis counter with automatic TTL expiry. Returns `429` with `retryAfter` when the limit is exceeded.

```js
// Allow max 5 requests per 15 seconds per IP
app.get('/api/limited-route', shield.rateLimit(5, 15), (req, res) => {
  res.json({ message: 'Access granted!' });
});
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `maxRequests` | `number` | `60` | Max requests allowed per window |
| `windowInSeconds` | `number` | `60` | Rolling time window in seconds |

**Response Headers set automatically:**

| Header | Value |
|---|---|
| `X-RateLimit-Limit` | Maximum requests allowed |
| `X-RateLimit-Remaining` | Requests remaining in window |
| `X-RateLimit-Reset` | Seconds until the window resets |

**429 Response body:**
```json
{
  "status": "error",
  "message": "Too many requests. Please slow down.",
  "retryAfter": 9
}
```

---

### `shield.invalidate(routePattern)` — Cache Invalidation

Wipes cached keys matching a route. Supports exact paths and `*` wildcards. Logs the number of keys cleared.

```js
// Exact route
await shield.invalidate('/api/products');

// Wildcard — clears every cached route under /api/
await shield.invalidate('/api/*');

// Wildcard — clears all cache entries
await shield.invalidate('*');
```

| Pattern | Clears |
|---|---|
| `/api/products` | Only `GET /api/products` and `POST /api/products` |
| `/api/products/*` | All sub-routes under `/api/products/` |
| `/api/*` | Everything cached under `/api/` |
| `*` | All VectorX Shield cache entries |

---

## 🏗️ Full Production Example

```js
const express = require('express');
const VectorXShield = require('vectorx-shield');

const app = express();
app.use(express.json());

const shield = new VectorXShield({ url: process.env.REDIS_URL });

// ─── Cached + Rate-Limited Public Route ──────────────────────────────────────

app.get(
  '/api/leaderboard',
  shield.rateLimit(30, 60),  // 30 req/min per IP
  shield.cache(10),           // cache result for 10s
  async (req, res) => {
    const board = await db.getTopPlayers();
    res.json({ status: 'success', data: board });
  }
);

// ─── Mutation — invalidates related cache ────────────────────────────────────

app.post('/api/scores', async (req, res) => {
  await db.insertScore(req.body);
  await shield.invalidate('/api/leaderboard'); // bust stale cache
  res.json({ status: 'success', message: 'Score recorded!' });
});

// ─── Admin — wipe entire API cache ──────────────────────────────────────────

app.post('/admin/cache/clear', async (req, res) => {
  await shield.invalidate('/api/*');
  res.json({ status: 'success', message: 'Full API cache cleared.' });
});

app.listen(process.env.PORT || 3000);
```

---

## 🔧 Configuration Options

```js
new VectorXShield(options)
```

| Option | Type | Description |
|---|---|---|
| `url` | `string` | Redis connection URL (e.g. `redis://localhost:6379`) |
| `mock` | `boolean` | Use built-in in-memory store (dev/testing only) |
| `socket` | `object` | Raw socket options forwarded to the Redis client |
| `password` | `string` | Redis AUTH password |
| `database` | `number` | Redis DB index (default: `0`) |

All options (except `mock`) are forwarded directly to the official [`redis`](https://github.com/redis/node-redis) npm client.

---

## 🔍 How It Works

```
Incoming Request
       │
       ├──── rateLimit() ────────────────────────────────────────────┐
       │      │                                                       │
       │   Count IP hits in Redis                                     │
       │      │                                                       │
       │   Over limit? ──── Yes ──► 429 Too Many Requests 🚫         │
       │      │ No                                                    │
       │      ▼                                                       │
       └──── cache() ────────────────────────────────────────────────┘
              │
           Cache key hit? ──── Yes ──► Return cached JSON instantly ⚡
              │ No
              ▼
         Route Handler runs
              │
              ▼
         res.json() fires
              │
         Intercept ──► Store in Redis with TTL
              │
         Response sent to client
```

---

## 🧪 Testing Locally

Run the included test server (mock store — no Redis required):

```bash
node server.js
```

**Test Caching:**
```bash
# Hit 1 — cold (~2000ms)
curl -w "\nTime: %{time_total}s\n" http://localhost:3000/api/heavy-data

# Hit 2 — cached (<10ms)
curl -w "\nTime: %{time_total}s\n" http://localhost:3000/api/heavy-data
```

**Test Rate Limiter** *(limit: 3 req / 10s)*:
```bash
for i in 1 2 3 4 5; do
  echo -n "Request $i: "
  curl -s -o /dev/null -w "HTTP %{http_code}\n" http://localhost:3000/api/limited-route
done
```

**Test Wildcard Invalidation:**
```bash
# Warm the cache
curl http://localhost:3000/api/heavy-data

# Wipe all /api/* cache keys at once
curl -X POST http://localhost:3000/api/clear-all
```

---

## 📋 Console Log Reference

| Log | Meaning |
|---|---|
| `⚡ VectorX Shield: Connected to Redis Successfully!` | Redis handshake complete |
| `⚡ VectorX Shield: Mock in-memory store active!` | Mock mode initialized |
| `📭 VectorX Shield [Cache MISS]` | No cached entry — route handler runs |
| `⚡ VectorX Shield [Cache HIT]` | Cached entry found — instant response |
| `🔢 VectorX Shield [Rate Check]: IP -> route (n/max)` | Request counted within limit |
| `🚫 VectorX Shield [Rate Limited]: IP -> route` | Limit exceeded — `429` returned |
| `🗑️ VectorX Shield: N key(s) cleared for pattern` | Invalidation completed |
| `❌ VectorX Shield [Redis Error]` | Redis error — fail-safe activated |

---

## 📄 License

MIT © VectorX Shield — Built with ⚡ for high-performance Express APIs.

---

<div align="center">

**If VectorX Shield saves you milliseconds, give it a ⭐ on GitHub**

</div>
