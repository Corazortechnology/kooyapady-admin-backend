// routes/images.js
const express = require("express");
const router = express.Router();
const multer = require("multer");
const fs = require("fs");
const cloudinary = require("cloudinary").v2;
const Folder = require("../models/folder");
const auth = require("../middleware/auth");

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const upload = multer({ dest: "uploads/" });

/**
 * POST /:folderId
 * - Upload files (multipart/form-data key: "file")
 * - Optional labels: either labels[] (multiple) or labels (single string)
 *   Sent in same order as files.
 */
router.post("/:folderId", auth, upload.array("file"), async (req, res) => {
  console.log("FILES RECEIVED:", req.files);
  console.log("BODY:", req.body);

  const { folderId } = req.params;
  try {
    const folder = await Folder.findById(folderId);
    if (!folder) return res.status(404).json({ message: "Folder not found" });

    // Normalize labels: handle labels, labels[] or single string value
    let labels = req.body.labels ?? req.body["labels[]"];
    if (labels !== undefined && typeof labels === "string") {
      // single string -> array with one element
      labels = [labels];
    }
    // If labels is undefined, that's fine (labels optional)

    const results = [];

    for (let i = 0; i < (req.files || []).length; i++) {
      const file = req.files[i];

      // upload to Cloudinary
      const uploaded = await cloudinary.uploader.upload(file.path, {
        folder: `koovappady/${folder.name}`,
      });

      const label = Array.isArray(labels) ? labels[i] : labels; // may be undefined

      const imageObj = {
        url: uploaded.secure_url,
        public_id: uploaded.public_id,
        ...(label !== undefined ? { label } : {}), // only include label when provided
      };

      folder.images.push(imageObj);
      results.push(imageObj);

      // clean up temp file (safe)
      try {
        fs.unlinkSync(file.path);
      } catch (e) {
        console.warn("Failed to remove temp file:", file.path, e);
      }
    }

    await folder.save();
    return res.json({ uploaded: results });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Upload failed" });
  }
});

/**
 * GET (authenticated) - returns folder images
 */
router.get("/:folderId", auth, async (req, res) => {
  try {
    const folder = await Folder.findById(req.params.folderId);
    if (!folder) return res.status(404).json({ message: "Folder not found" });

    return res.json({ images: folder.images });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Could not fetch images" });
  }
});

/**
 * GET public - returns folder images without auth
 */
router.get("/:folderId/public", async (req, res) => {
  try {
    const folder = await Folder.findById(req.params.folderId);
    if (!folder) return res.status(404).json({ message: "Folder not found" });

    return res.json({ images: folder.images });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Could not fetch images" });
  }
});

/**
 * DELETE /:folderId/:publicId
 * - Deletes image from Cloudinary and removes from folder.images
 */
router.delete("/:folderId/:publicId", auth, async (req, res) => {
  try {
    const { folderId } = req.params;
    // publicId may be URL encoded when sent in URL, so decode
    const publicId = decodeURIComponent(req.params.publicId);

    const folder = await Folder.findById(folderId);
    if (!folder) return res.status(404).json({ message: "Folder not found" });

    // delete from Cloudinary
    await cloudinary.uploader.destroy(publicId);

    // remove from DB array
    folder.images = folder.images.filter((img) => img.public_id !== publicId);
    await folder.save();

    return res.json({ message: "Image deleted successfully", images: folder.images });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Delete failed" });
  }
});

/**
 * PUT /:folderId/:publicId
 * - Update metadata for an image:
 *   - To update label only: send { newLabel: "..." }
 *   - To rename Cloudinary public_id (and update url): send { newName: "<new_public_id>" }
 *   - You can send both to rename and update label at once.
 */
router.put("/:folderId/:publicId", auth, async (req, res) => {
  try {
    const { folderId } = req.params;
    // decode in case public id was encoded in URL
    const publicId = decodeURIComponent(req.params.publicId);
    const { newName, newLabel } = req.body;

    const folder = await Folder.findById(folderId);
    if (!folder) return res.status(404).json({ message: "Folder not found" });

    const imageIndex = folder.images.findIndex((img) => img.public_id === publicId);
    if (imageIndex === -1) return res.status(404).json({ message: "Image not found" });

    // If newName provided, rename resource on Cloudinary and update stored public_id + url
    if (newName) {
      const renamed = await cloudinary.uploader.rename(publicId, newName);
      folder.images[imageIndex].public_id = renamed.public_id;
      folder.images[imageIndex].url = renamed.secure_url;
    }

    // Update label if provided (allow empty string to clear label)
    if (newLabel !== undefined) {
      folder.images[imageIndex].label = newLabel;
    }

    await folder.save();

    return res.json({ message: "Image updated", image: folder.images[imageIndex] });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Update failed" });
  }
});

module.exports = router;


// const express = require("express");
// const router = express.Router();
// const multer = require("multer");
// const fs = require("fs");
// const cloudinary = require("cloudinary").v2;
// const Folder = require("../models/folder");
// const auth = require("../middleware/auth");

// cloudinary.config({
//   cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
//   api_key: process.env.CLOUDINARY_API_KEY,
//   api_secret: process.env.CLOUDINARY_API_SECRET,
// });

// const upload = multer({ dest: "uploads/" });

// router.post("/:folderId", auth, upload.array("file"), async (req, res) => {
//   console.log("FILES RECEIVED:", req.files);
//   console.log("BODY:", req.body);

//   const { folderId } = req.params;
//   try {
//     const folder = await Folder.findById(folderId);
//     if (!folder) return res.status(404).json({ message: "Folder not found" });

//     const results = [];

//     for (let file of req.files || []) {
//       const uploaded = await cloudinary.uploader.upload(file.path, {
//         folder: `koovappady/${folder.name}`,
//       });

//       const imageObj = {
//         url: uploaded.secure_url,
//         public_id: uploaded.public_id,
//       };
//       folder.images.push(imageObj);
//       results.push(imageObj);

//       fs.unlinkSync(file.path);
//     }

//     await folder.save();
//     res.json({ uploaded: results });
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ message: "Upload failed" });
//   }
// });

// router.get("/:folderId", auth, async (req, res) => {
//   try {
//     const folder = await Folder.findById(req.params.folderId);
//     if (!folder) return res.status(404).json({ message: "Folder not found" });

//     res.json({ images: folder.images });
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ message: "Could not fetch images" });
//   }
// });
// router.get("/:folderId/public", async (req, res) => {
//   try {
//     const folder = await Folder.findById(req.params.folderId);
//     if (!folder) return res.status(404).json({ message: "Folder not found" });

//     res.json({ images: folder.images });
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ message: "Could not fetch images" });
//   }
// });

// router.delete("/:folderId/:publicId", auth, async (req, res) => {
//   try {
//     const { folderId } = req.params;
//     const publicId = decodeURIComponent(req.params.publicId);

//     const folder = await Folder.findById(folderId);
//     if (!folder) return res.status(404).json({ message: "Folder not found" });

//     await cloudinary.uploader.destroy(publicId);

//     folder.images = folder.images.filter((img) => img.public_id !== publicId);
//     await folder.save();

//     res.json({ message: "Image deleted successfully", images: folder.images });
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ message: "Delete failed" });
//   }
// });

// router.put("/:folderId/:publicId", auth, async (req, res) => {
//   try {
//     const { folderId, publicId } = req.params;
//     const { newName } = req.body;

//     const folder = await Folder.findById(folderId);
//     if (!folder) return res.status(404).json({ message: "Folder not found" });

//     const renamed = await cloudinary.uploader.rename(publicId, newName);

//     const imageIndex = folder.images.findIndex(
//       (img) => img.public_id === publicId
//     );
//     if (imageIndex === -1)
//       return res.status(404).json({ message: "Image not found" });

//     folder.images[imageIndex].public_id = renamed.public_id;
//     folder.images[imageIndex].url = renamed.secure_url;
//     await folder.save();

//     res.json({ message: "Image renamed", image: folder.images[imageIndex] });
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ message: "Rename failed" });
//   }
// });

// module.exports = router;
