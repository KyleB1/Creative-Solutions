/**
 * contact-routes.js - Public contact form submission endpoint
 *
 * POST /api/contact
 */

const express = require('express');
const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');

const router = express.Router();

const CONTACT_STORE_PATH = path.resolve(
  process.env.CONTACT_STORE_PATH ||
    path.join(__dirname, 'data', 'contact-submissions.json')
);

async function loadSubmissions() {
  try {
    const raw = await fs.readFile(CONTACT_STORE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_err) {
    return [];
  }
}

async function saveSubmissions(list) {
  await fs.mkdir(path.dirname(CONTACT_STORE_PATH), { recursive: true });
  await fs.writeFile(CONTACT_STORE_PATH, JSON.stringify(list, null, 2), 'utf8');
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || ''));
}

/**
 * POST /api/contact
 * Body: { name, email, message }
 */
router.post('/', async (req, res) => {
  const name = String(req.body.name || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const message = String(req.body.message || '').trim();

  if (!name || !email || !message) {
    return res.status(400).json({ error: 'Name, email, and message are required.' });
  }

  if (name.length > 120) {
    return res.status(400).json({ error: 'Name must be 120 characters or fewer.' });
  }

  if (!isValidEmail(email)) {
    return res.status(400).json({ error: 'Please provide a valid email address.' });
  }

  if (message.length > 2000) {
    return res.status(400).json({ error: 'Message must be 2000 characters or fewer.' });
  }

  const submission = {
    id: crypto.randomBytes(8).toString('hex'),
    name,
    email,
    message,
    submittedAt: new Date().toISOString(),
    status: 'new'
  };

  try {
    const list = await loadSubmissions();
    list.push(submission);
    await saveSubmissions(list);
  } catch (err) {
    console.error('Contact form save error:', err);
    return res.status(500).json({ error: 'Unable to save your message. Please try again.' });
  }

  console.log(`[contact] New submission from ${email} (${submission.id})`);
  res.status(201).json({ message: 'Thank you! We will be in touch within one business day.' });
});

module.exports = router;
