const express = require('express');
const VectorXShield = require('./index.js');

const app = express();
app.use(express.json());

const shield = new VectorXShield({ mock: true });

// ─── Route 1: Caching Demo ────────────────────────────────────────────────────

app.get('/api/heavy-data', shield.cache(30), (req, res) => {
  console.log('🔄 MongoDB Database hitting... (Fetching heavy data)');

  setTimeout(() => {
    res.json({
      status: 'success',
      message: 'Elite data fetched successfully!',
      timestamp: new Date().toISOString(),
      data: ['Item 1', 'Item 2', 'Item 3', 'Item 4'],
    });
  }, 2000);
});

// ─── Route 2: Cache Invalidation ─────────────────────────────────────────────

app.post('/api/update-data', async (req, res) => {
  console.log('✍️ Data updated in database! Clearing VectorX cache...');
  await shield.invalidate('/api/heavy-data');
  res.json({ status: 'success', message: 'Database updated and cache wiped out!' });
});

// ─── Route 3: Wildcard Invalidation ──────────────────────────────────────────

app.post('/api/clear-all', async (req, res) => {
  console.log('🧹 Clearing all /api/* cache entries...');
  await shield.invalidate('/api/*');
  res.json({ status: 'success', message: 'All /api/* cache entries cleared!' });
});

// ─── Route 4: Rate Limiter Demo (max 3 requests per 10 seconds) ───────────────

app.get('/api/limited-route', shield.rateLimit(3, 10), (req, res) => {
  res.json({
    status: 'success',
    message: 'You are within the rate limit. Access granted!',
    timestamp: new Date().toISOString(),
  });
});

// ─── Server ───────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 VectorX Shield Test Server running on port ${PORT}`);
});
