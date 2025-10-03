
const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');

router.post('/login', (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ message: 'Email and password required' });


    if (email === process.env.ADMIN_EMAIL && password === process.env.ADMIN_PASSWORD) {
        const payload = { email };
        const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });
        return res.json({ token });
    }


    return res.status(401).json({ message: 'Invalid credentials' });
});


module.exports = router;