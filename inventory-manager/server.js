const express = require('express');
const path = require('path');
const cors = require('cors');
const {
  getInventoryData,
  updateImageUrlBySku,
  updateClassificationBySku
} = require('./sheets');

const app = express();
const port = process.env.PORT || 8080;

app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.get('/healthz', (_req, res) => {
  res.json({ success: true });
});

function basicAuth(req, res, next) {
  const configuredUser = process.env.ADMIN_USER;
  const configuredPass = process.env.ADMIN_PASS;

  if (!configuredUser || !configuredPass) {
    return res.status(500).json({ error: 'Missing ADMIN_USER/ADMIN_PASS environment configuration.' });
  }

  const header = req.headers.authorization || '';
  if (!header.startsWith('Basic ')) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Inventory Dashboard"');
    return res.status(401).send('Authentication required');
  }

  const encoded = header.slice(6);
  const decoded = Buffer.from(encoded, 'base64').toString('utf8');
  const separator = decoded.indexOf(':');

  if (separator < 0) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Inventory Dashboard"');
    return res.status(401).send('Invalid authorization header');
  }

  const user = decoded.slice(0, separator);
  const pass = decoded.slice(separator + 1);

  if (user !== configuredUser || pass !== configuredPass) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Inventory Dashboard"');
    return res.status(401).send('Invalid credentials');
  }

  return next();
}

app.use(['/api', '/'], basicAuth);

app.get('/api/inventory', async (_req, res) => {
  try {
    const data = await getInventoryData();
    res.json(data);
  } catch (error) {
    console.error('GET /api/inventory failed:', error);
    res.status(500).json({ error: error.message || 'Failed to load inventory' });
  }
});


app.post('/api/items/classify', async (req, res) => {
  const { sku, category, parentId } = req.body || {};

  try {
    await updateClassificationBySku(sku, category, parentId);
    res.json({ success: true });
  } catch (error) {
    console.error('POST /api/items/classify failed:', error);
    const statusCode = /Missing|not found/i.test(error.message || '') ? 400 : 500;
    res.status(statusCode).json({ error: error.message || 'Failed to update classification' });
  }
});

app.post('/api/items/image', async (req, res) => {
  const { sku, imageUrl } = req.body || {};

  try {
    const result = await updateImageUrlBySku(sku, imageUrl);
    res.json(result);
  } catch (error) {
    console.error('POST /api/items/image failed:', error);
    const statusCode = /Missing|not found/i.test(error.message || '') ? 400 : 500;
    res.status(statusCode).json({ error: error.message || 'Failed to update image URL' });
  }
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(port, () => {
  console.log(`Inventory dashboard listening on port ${port}`);
});
