
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
    const { folderId } = req.params;
    try {
        const folder = await Folder.findById(folderId);
        if (!folder) return res.status(404).json({ message: 'Folder not found' });


        const results = [];


        for (let file of req.files) {
            const uploaded = await cloudinary.uploader.upload(file.path, { folder: `koovappady/${folder.name}` });
            // push image info into folder.images
            const imageObj = { url: uploaded.secure_url, public_id: uploaded.public_id };
            folder.images.push(imageObj);
            results.push(imageObj);
            // remove temp file
            fs.unlinkSync(file.path);
        }


        await folder.save();
        res.json({ uploaded: results });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Upload failed' });
    }
});


module.exports = router;