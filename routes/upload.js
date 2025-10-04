
const express = require('express');
const router = express.Router();
const multer = require('multer');
const fs = require('fs');
const cloudinary = require('cloudinary').v2;
const Folder = require('../models/folder');
const auth = require('../middleware/auth');

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
});

const upload = multer({ dest: 'uploads/' });

router.post('/:folderId', auth, upload.array('file'), async (req, res) => {
    console.log("FILES RECEIVED:", req.files);
    console.log("BODY:", req.body);

    const { folderId } = req.params;
    try {
        const folder = await Folder.findById(folderId);
        if (!folder) return res.status(404).json({ message: 'Folder not found' });

        const results = [];

        for (let file of req.files || []) {
            const uploaded = await cloudinary.uploader.upload(file.path, {
                folder: `koovappady/${folder.name}`
            });

            const imageObj = { url: uploaded.secure_url, public_id: uploaded.public_id };
            folder.images.push(imageObj);
            results.push(imageObj);

            fs.unlinkSync(file.path);
        }

        await folder.save();
        res.json({ uploaded: results });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Upload failed' });
    }
});

router.get('/:folderId', auth, async (req, res) => {
    try {
        const folder = await Folder.findById(req.params.folderId);
        if (!folder) return res.status(404).json({ message: 'Folder not found' });

        res.json({ images: folder.images });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Could not fetch images' });
    }
});


router.delete('/:folderId/:publicId', auth, async (req, res) => {
    try {
        const { folderId } = req.params;
        const publicId = decodeURIComponent(req.params.publicId);

        const folder = await Folder.findById(folderId);
        if (!folder) return res.status(404).json({ message: 'Folder not found' });

        await cloudinary.uploader.destroy(publicId);

        folder.images = folder.images.filter(img => img.public_id !== publicId);
        await folder.save();

        res.json({ message: 'Image deleted successfully', images: folder.images });

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Delete failed' });
    }
});

router.put('/:folderId/:publicId', auth, async (req, res) => {
    try {
        const { folderId, publicId } = req.params;
        const { newName } = req.body;

        const folder = await Folder.findById(folderId);
        if (!folder) return res.status(404).json({ message: 'Folder not found' });

        const renamed = await cloudinary.uploader.rename(publicId, newName);

        const imageIndex = folder.images.findIndex(img => img.public_id === publicId);
        if (imageIndex === -1) return res.status(404).json({ message: 'Image not found' });

        folder.images[imageIndex].public_id = renamed.public_id;
        folder.images[imageIndex].url = renamed.secure_url;
        await folder.save();

        res.json({ message: 'Image renamed', image: folder.images[imageIndex] });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Rename failed' });
    }
});

module.exports = router;
