const { createClient } = require('redis');

class MemoryStore {
  constructor() {
    this._store = new Map();
    this._timers = new Map();
    this._listeners = {};
  }

  on(event, cb) {
    this._listeners[event] = cb;
    return this;
  }

  async connect() {
    if (this._listeners['connect']) this._listeners['connect']();
  }

  async get(key) {
    const entry = this._store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this._store.delete(key);
      return null;
    }
    return entry.value;
  }

  async setEx(key, ttlSeconds, value) {
    if (this._timers.has(key)) clearTimeout(this._timers.get(key));
    this._store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
    const timer = setTimeout(() => this._store.delete(key), ttlSeconds * 1000);
    this._timers.set(key, timer);
  }

  async incr(key) {
    const entry = this._store.get(key);
    const now = Date.now();
    if (!entry || now > entry.expiresAt) {
      this._store.set(key, { value: '1', expiresAt: Infinity });
      return 1;
    }
    const next = parseInt(entry.value, 10) + 1;
    entry.value = String(next);
    return next;
  }

  async expire(key, ttlSeconds) {
    const entry = this._store.get(key);
    if (!entry) return;
    entry.expiresAt = Date.now() + ttlSeconds * 1000;
    if (this._timers.has(key)) clearTimeout(this._timers.get(key));
    const timer = setTimeout(() => this._store.delete(key), ttlSeconds * 1000);
    this._timers.set(key, timer);
  }

  async ttl(key) {
    const entry = this._store.get(key);
    if (!entry || entry.expiresAt === Infinity) return -1;
    return Math.ceil((entry.expiresAt - Date.now()) / 1000);
  }

  async keys(pattern) {
    const escaped = pattern.replace(/[-[\]{}()+?.,\\^$|#\s]/g, '\\$&');
    const regex = new RegExp('^' + escaped.replace(/\*/g, '.*') + '$');
    return [...this._store.keys()].filter(k => regex.test(k));
  }

  async del(keys) {
    (Array.isArray(keys) ? keys : [keys]).forEach(k => {
      this._store.delete(k);
      if (this._timers.has(k)) {
        clearTimeout(this._timers.get(k));
        this._timers.delete(k);
      }
    });
  }
}

class VectorXShield {
  constructor(redisOptions = {}) {
    if (redisOptions.mock) {
      this.client = new MemoryStore();
      this.isRedisConnected = true;
      console.log('⚡ VectorX Shield: Mock in-memory store active!');
    } else {
      this.client = createClient(redisOptions);
      this.isRedisConnected = false;

      this.client.on('error', (err) => {
        console.error('❌ VectorX Shield [Redis Error]:', err.message);
        this.isRedisConnected = false;
      });

      this.client.on('connect', () => {
        console.log('⚡ VectorX Shield: Connected to Redis Successfully!');
        this.isRedisConnected = true;
      });

      this.client.connect().catch(() => {
        console.error('❌ VectorX Shield: Initial connection failed. Fail-Safe Active.');
        this.isRedisConnected = false;
      });
    }
  }

  cache(ttl = 3600) {
    return async (req, res, next) => {
      if (!this.isRedisConnected) {
        return next();
      }

      const cacheKey = `vx-cache:${req.method}:${req.originalUrl || req.url}`;

      try {
        const cachedResponse = await this.client.get(cacheKey);

        if (cachedResponse) {
          console.log(`⚡ VectorX Shield [Cache HIT]: ${cacheKey}`);
          return res.status(200).json(JSON.parse(cachedResponse));
        }

        console.log(`📭 VectorX Shield [Cache MISS]: ${cacheKey}`);

        const originalJson = res.json;

        res.json = (body) => {
          if (res.statusCode === 200 && this.isRedisConnected) {
            this.client.setEx(cacheKey, ttl, JSON.stringify(body))
              .catch(err => console.error('❌ VectorX Shield [Cache Set Error]:', err));
          }
          return originalJson.call(res, body);
        };

        next();
      } catch (error) {
        console.error('❌ VectorX Shield [Bypass]:', error);
        next();
      }
    };
  }

  rateLimit(maxRequests = 60, windowInSeconds = 60) {
    return async (req, res, next) => {
      if (!this.isRedisConnected) {
        return next();
      }

      const ip = req.ip || req.socket.remoteAddress || 'unknown';
      const route = req.originalUrl || req.url;
      const rateLimitKey = `vx-rate:${ip}:${route}`;

      try {
        const count = await this.client.incr(rateLimitKey);

        if (count === 1) {
          await this.client.expire(rateLimitKey, windowInSeconds);
        }

        const remaining = Math.max(0, maxRequests - count);
        const ttl = await this.client.ttl(rateLimitKey);

        res.setHeader('X-RateLimit-Limit', maxRequests);
        res.setHeader('X-RateLimit-Remaining', remaining);
        res.setHeader('X-RateLimit-Reset', ttl);

        if (count > maxRequests) {
          console.warn(`🚫 VectorX Shield [Rate Limited]: ${ip} -> ${route} (${count}/${maxRequests} in ${windowInSeconds}s window)`);
          return res.status(429).json({
            status: 'error',
            message: 'Too many requests. Please slow down.',
            retryAfter: ttl,
          });
        }

        console.log(`🔢 VectorX Shield [Rate Check]: ${ip} -> ${route} (${count}/${maxRequests})`);
        next();
      } catch (error) {
        console.error('❌ VectorX Shield [Rate Limit Error]:', error);
        next();
      }
    };
  }

  async invalidate(routePattern) {
    if (!this.isRedisConnected) return;

    try {
      const isWildcard = routePattern.includes('*');
      const keyPattern = isWildcard
        ? `vx-cache:*:${routePattern}`
        : `vx-cache:*:${routePattern}`;

      const keys = await this.client.keys(keyPattern);

      if (keys.length > 0) {
        await this.client.del(keys);
        console.log(`🗑️ VectorX Shield: ${keys.length} key(s) cleared for pattern -> ${routePattern}`);
      } else {
        console.log(`🗑️ VectorX Shield: No cache keys matched -> ${routePattern}`);
      }
    } catch (err) {
      console.error('❌ VectorX Shield [Invalidation Error]:', err);
    }
  }
}

module.exports = VectorXShield;
