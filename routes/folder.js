
const express = require('express');
const router = express.Router();
const Folder = require('../models/folder');
const auth = require('../middleware/auth');


router.get('/', auth, async (req, res) => {
    try {
        const folders = await Folder.find().sort({ createdAt: 1 });
        res.json(folders);
    } catch (err) {
        res.status(500).json({ message: 'Server error' });
    }
});


router.post('/', auth, async (req, res) => {
    const { name } = req.body;
    if (!name) return res.status(400).json({ message: 'Name is required' });


    try {
        const exists = await Folder.findOne({ name });
        if (exists) return res.status(400).json({ message: 'Folder already exists' });
        const folder = new Folder({ name });
        await folder.save();
        res.status(201).json(folder);
    } catch (err) {
        res.status(500).json({ message: 'Server error' });
    }
});


router.put('/:id', auth, async (req, res) => {
    const { name } = req.body;
    if (!name) return res.status(400).json({ message: 'Name is required' });


    try {
        const folder = await Folder.findById(req.params.id);
        if (!folder) return res.status(404).json({ message: 'Folder not found' });
        folder.name = name;
        await folder.save();
        res.json(folder);
    } catch (err) {
        res.status(500).json({ message: 'Server error' });
    }
});


router.delete('/:id', auth, async (req, res) => {
    try {
        const folder = await Folder.findById(req.params.id);
        if (!folder) {
            return res.status(404).json({ message: 'Folder not found' });
        }

        await Folder.findByIdAndDelete(req.params.id);
        res.json({ message: 'Folder deleted successfully' });
    } catch (err) {
        console.error("Delete Error:", err.message);
        res.status(500).json({ message: 'Server error' });
    }
});
module.exports = router;