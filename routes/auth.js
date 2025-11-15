// routes/auth.js
const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const Admin = require('../models/Admin'); // adjust path if needed
require('dotenv').config();

// helper: sign token
function signToken(admin) {
  // accept either mongoose doc or plain object with id/_id
  const id = admin._id ? admin._id : admin.id;
  const payload = { id, email: admin.email, role: admin.role || 'admin' };
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });
}

// middleware: authenticate token and attach admin doc (or minimal admin) to req.currentAdmin
async function authenticate(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ message: 'Authorization token required' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Preferred: token contains DB id -> load by id
    if (decoded.id) {
      try {
        const admin = await Admin.findById(decoded.id).exec();
        if (!admin) {
          // token contains id but admin not found
          return res.status(401).json({ message: 'Invalid token: admin not found' });
        }
        req.currentAdmin = admin;
        return next();
      } catch (err) {
        console.error('DB lookup error in authenticate:', err);
        return res.status(500).json({ message: 'Server error during authentication' });
      }
    }

    // Fallback: token contains email -> try to find DB-backed admin by email
    if (decoded.email) {
      try {
        const adminByEmail = await Admin.findOne({ email: decoded.email.toLowerCase().trim() }).exec();
        if (adminByEmail) {
          req.currentAdmin = adminByEmail;
          return next();
        }

        // Optional: allow ephemeral env-admin tokens (bootstrap flow)
        // Only accept if token explicitly had isEnvAdmin flag.
        if (decoded.isEnvAdmin) {
          // minimal admin-like object (not persisted)
          req.currentAdmin = { email: decoded.email, role: decoded.role || 'admin', isEnvAdmin: true };
          return next();
        }
      } catch (err) {
        console.error('DB lookup error in authenticate (email fallback):', err);
        return res.status(500).json({ message: 'Server error during authentication' });
      }
    }

    // No matching admin found
    return res.status(401).json({ message: 'Invalid token: admin not found' });
  } catch (err) {
    return res.status(401).json({ message: 'Invalid or expired token', error: err.message });
  }
}

// login: check DB first, fallback to env-bootstrap (but ensure DB-backed admin is created)
router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ message: 'Email and password required' });

  try {
    const normalizedEmail = email.toLowerCase().trim();
    const admin = await Admin.findOne({ email: normalizedEmail }).exec();

    if (admin) {
      const ok = await bcrypt.compare(password, admin.passwordHash);
      if (!ok) return res.status(401).json({ message: 'Invalid credentials' });

      const token = signToken(admin);
      return res.json({ token });
    }

    // fallback to ENV bootstrap credential (useful for very first admin if DB was not seeded)
    if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
      if (email === process.env.ADMIN_EMAIL && password === process.env.ADMIN_PASSWORD) {
        // Ensure a DB-backed admin exists for this env-admin — create if missing.
        let adminRecord = await Admin.findOne({ email: normalizedEmail }).exec();
        if (!adminRecord) {
          const passwordHash = await bcrypt.hash(password, 10);
          adminRecord = new Admin({ email: normalizedEmail, passwordHash });
          await adminRecord.save();
        }

        // Sign a token that includes the DB id (preferred)
        const token = signToken(adminRecord);
        return res.json({ token, note: 'Logged in using ENV admin; DB record ensured.' });
      }
    }

    return res.status(401).json({ message: 'Invalid credentials' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Server error', error: err.message });
  }
});

/**
 * Bootstrap route to create the very first admin using env credentials.
 * Only allowed if no admin exists in DB AND request provides the same env creds.
 * Call this once during setup if you prefer.
 */
router.post('/init-admin', async (req, res) => {
  try {
    const adminCount = await Admin.countDocuments();
    if (adminCount > 0) return res.status(400).json({ message: 'Admins already exist. Use protected create route.' });

    // require env creds to match request body
    const { email, password } = req.body || {};
    if (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD) {
      return res.status(500).json({ message: 'No ENV admin credentials configured on server.' });
    }

    if (email !== process.env.ADMIN_EMAIL || password !== process.env.ADMIN_PASSWORD) {
      return res.status(401).json({ message: 'Provided credentials do not match server configured admin.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const newAdmin = new Admin({ email: email.toLowerCase().trim(), passwordHash });
    await newAdmin.save();

    const token = signToken(newAdmin);
    return res.json({ message: 'Initial admin created', token });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Server error', error: err.message });
  }
});

/**
 * Protected: create another admin.
 * Only callable by an authenticated admin (token required).
 * Body: { email, password }
 */
router.post('/create-admin', authenticate, async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ message: 'Email and password required' });

    // ensure only DB-backed admin (or role 'admin') can create others
    // If req.currentAdmin is an ephemeral env admin (isEnvAdmin), it still has role 'admin'
    // If you want to restrict to only persisted admins, check for req.currentAdmin._id existence.
    if (!req.currentAdmin || (req.currentAdmin.role !== 'admin' && req.currentAdmin.role !== 'superadmin')) {
      return res.status(403).json({ message: 'Forbidden: admin only' });
    }

    const normalized = email.toLowerCase().trim();
    const existing = await Admin.findOne({ email: normalized }).exec();
    if (existing) return res.status(409).json({ message: 'Admin with this email already exists' });

    const passwordHash = await bcrypt.hash(password, 10);
    const newAdmin = new Admin({ email: normalized, passwordHash });
    await newAdmin.save();

    return res.status(201).json({ message: 'New admin created', admin: { id: newAdmin._id, email: newAdmin.email } });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Server error', error: err.message });
  }
});

module.exports = router;

// const express = require('express');
// const router = express.Router();
// const jwt = require('jsonwebtoken');

// router.post('/login', (req, res) => {
//     const { email, password } = req.body;
//     if (!email || !password) return res.status(400).json({ message: 'Email and password required' });


//     if (email === process.env.ADMIN_EMAIL && password === process.env.ADMIN_PASSWORD) {
//         const payload = { email };
//         const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });
//         return res.json({ token });
//     }


//     return res.status(401).json({ message: 'Invalid credentials' });
// });


// module.exports = router;