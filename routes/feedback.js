const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const Feedback = require('../models/Feedback');
const auth = require('../middleware/auth');

// Create feedback -> POST /feedback
router.post('/', async (req, res) => {
  try {
    const { name, email, message } = req.body;

    if (!name || !email || !message) {
      return res.status(400).json({ error: 'name, email and message are required' });
    }

    const fb = new Feedback({ name, email, message });
    const saved = await fb.save();
    return res.status(201).json(saved);
  } catch (err) {
    if (err.name === 'ValidationError') {
      const details = Object.values(err.errors).map(e => e.message);
      return res.status(400).json({ error: 'Validation failed', details });
    }
    console.error('Feedback POST error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// optional query params: ?limit=50&skip=0
router.get('/', auth, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || '100', 10), 1000);
    const skip = Math.max(parseInt(req.query.skip || '0', 10), 0);
    const items = await Feedback.find().sort({ createdAt: -1 }).skip(skip).limit(limit).lean();
    return res.json(items);
  } catch (err) {
    console.error('Feedback GET error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// OPTIONAL: Get one feedback by id -> GET /feedback/:id
router.get('/:id', auth, async (req, res) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ error: 'Invalid id' });
  }
  try {
    const item = await Feedback.findById(id).lean();
    if (!item) return res.status(404).json({ error: 'Not found' });
    return res.json(item);
  } catch (err) {
    console.error('Feedback GET by id error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
