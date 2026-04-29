/**
 * server.js  -  Express server serving the dashboard and outputs as JSON API
 *
 * Usage:  node server.js
 * Then open: http://localhost:3000
 */

'use strict';

const express = require('express');
const path    = require('path');
const fs      = require('fs');

const app     = express();
const PORT    = process.env.PORT || 3000;
const OUT_DIR = path.join(__dirname, 'outputs');

// Suppress favicon 404
app.get('/favicon.ico', (req, res) => res.status(204).end());

// Serve static dashboard files
app.use(express.static(path.join(__dirname, 'public')));

// JSON API , serve any file from outputs/
app.get('/api/:file', (req, res) => {
  const filePath = path.join(OUT_DIR, req.params.file);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found. Run: node scripts/run_all.js first.' });
  }
  res.sendFile(filePath);
});

// List available output files
app.get('/api', (req, res) => {
  if (!fs.existsSync(OUT_DIR)) return res.json({ files: [] });
  const files = fs.readdirSync(OUT_DIR).filter(f => f.endsWith('.json'));
  res.json({ files });
});

app.listen(PORT, () => {
  console.log(`\n PROTEUS | Maldives Sea Level Rise Platform running at http://localhost:${PORT}`);
  console.log('  Press Ctrl+C to stop.\n');
});
