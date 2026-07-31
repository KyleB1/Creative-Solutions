/**
 * contact-routes.js - Public contact form submission endpoint
 *
 * POST /api/contact
 */

const express = require('express');
const crypto = require('crypto');

const logger = require('./logger');
const dataStore = require('./data-store');

const router = express.Router();

async function loadSubmissions() {
  return dataStore.readContactSubmissions();
}

async function saveSubmissions(list) {
  await dataStore.writeContactSubmissions(list);
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
    logger.error('Contact form save error:', err);
    return res.status(500).json({ error: 'Unable to save your message. Please try again.' });
  }

  logger.info(`[contact] New submission from ${email} (${submission.id})`);
  res.status(201).json({ message: 'Thank you! We will be in touch within one business day.' });
});

module.exports = router;
