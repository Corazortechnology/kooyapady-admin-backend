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

// multer temp storage
const upload = multer({ dest: "uploads/" });

/**
 * POST /:folderId
 * Accepts multipart/form-data with optional fields:
 * - images: array of image files
 * - videos: array of video files
 * - imageLabels or labels: labels for images (array or single string)
 * - videoTitles: titles for videos (array or single string)
 *
 * Either images or videos or both can be provided. Nothing is mandatory.
 */
router.post("/:folderId", auth, upload.fields([
  { name: "images", maxCount: 20 },
  { name: "videos", maxCount: 10 },
  // Backwards-compat: accept generic 'file'
  { name: "file", maxCount: 20 }
]), async (req, res) => {
  console.log("FILES RECEIVED:", Object.keys(req.files).reduce((acc, k) => {
    acc[k] = req.files[k].length;
    return acc;
  }, {}));
  console.log("BODY:", req.body);

  const { folderId } = req.params;
  try {
    const folder = await Folder.findById(folderId);
    if (!folder) return res.status(404).json({ message: "Folder not found" });

    // Normalize image labels: accept imageLabels, labels (legacy) or labels[]
    let imageLabels = req.body.imageLabels ?? req.body.labels ?? req.body["labels[]"] ?? req.body["imageLabels[]"];
    if (imageLabels !== undefined && typeof imageLabels === "string") imageLabels = [imageLabels];

    // Normalize video titles
    let videoTitles = req.body.videoTitles ?? req.body["videoTitles[]"];
    if (videoTitles !== undefined && typeof videoTitles === "string") videoTitles = [videoTitles];

    const results = { images: [], videos: [] };

    // Helper to clean temp files
    const cleanupFile = (path) => {
      try {
        if (fs.existsSync(path)) fs.unlinkSync(path);
      } catch (e) {
        console.warn("Failed to remove temp file:", path, e);
      }
    };

    // Handle images array:
    // If client used 'file' for backwards compatibility, we'll treat files whose mimetype starts with 'image/' as images
    const imageFiles = [
      ...(req.files.images || []),
      // include files from generic 'file' that are images
      ...((req.files.file || []).filter(f => f.mimetype && f.mimetype.startsWith("image/"))),
    ];

    for (let i = 0; i < imageFiles.length; i++) {
      const file = imageFiles[i];
      const label = Array.isArray(imageLabels) ? imageLabels[i] : imageLabels; // may be undefined

      // upload to Cloudinary with resource_type image
      const uploaded = await cloudinary.uploader.upload(file.path, {
        folder: `koovappady/${folder.name}`,
        resource_type: "image",
      });

      const imageObj = {
        url: uploaded.secure_url,
        public_id: uploaded.public_id,
        ...(label !== undefined ? { label } : {}),
      };

      folder.images.push(imageObj);
      results.images.push(imageObj);

      cleanupFile(file.path);
    }

    // Handle video files:
    const videoFiles = [
      ...(req.files.videos || []),
      // include files from generic 'file' that are videos
      ...((req.files.file || []).filter(f => f.mimetype && f.mimetype.startsWith("video/"))),
    ];

    for (let i = 0; i < videoFiles.length; i++) {
      const file = videoFiles[i];
      const title = Array.isArray(videoTitles) ? videoTitles[i] : videoTitles; // may be undefined

      // upload to Cloudinary with resource_type video
      const uploaded = await cloudinary.uploader.upload(file.path, {
        folder: `koovappady/${folder.name}`,
        resource_type: "video",
      });

      const videoObj = {
        url: uploaded.secure_url,
        public_id: uploaded.public_id,
        ...(title !== undefined ? { title } : {}),
      };

      folder.videos.push(videoObj);
      results.videos.push(videoObj);

      cleanupFile(file.path);
    }

    await folder.save();
    return res.json({ uploaded: results });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Upload failed", error: err.message });
  }
});

/**
 * GET (authenticated) - returns folder images and videos
 */
router.get("/:folderId", auth, async (req, res) => {
  try {
    const folder = await Folder.findById(req.params.folderId);
    if (!folder) return res.status(404).json({ message: "Folder not found" });

    return res.json({ images: folder.images, videos: folder.videos });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Could not fetch media" });
  }
});

/**
 * GET public - returns folder images and videos without auth
 */
router.get("/:folderId/public", async (req, res) => {
  try {
    const folder = await Folder.findById(req.params.folderId);
    if (!folder) return res.status(404).json({ message: "Folder not found" });

    return res.json({ images: folder.images, videos: folder.videos });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Could not fetch media" });
  }
});

/**
 * DELETE /:folderId/:publicId
 * Deletes image or video from Cloudinary and removes from folder.
 * The endpoint will automatically check whether the publicId belongs to an image or video in this folder.
 */
router.delete("/:folderId/:publicId", auth, async (req, res) => {
  try {
    const { folderId } = req.params;
    const publicId = decodeURIComponent(req.params.publicId);

    const folder = await Folder.findById(folderId);
    if (!folder) return res.status(404).json({ message: "Folder not found" });

    // find in images
    const imgIndex = folder.images.findIndex((img) => img.public_id === publicId);
    if (imgIndex !== -1) {
      // delete image
      await cloudinary.uploader.destroy(publicId, { resource_type: "image" });
      folder.images.splice(imgIndex, 1);
      await folder.save();
      return res.json({ message: "Image deleted successfully", images: folder.images, videos: folder.videos });
    }

    // find in videos
    const vidIndex = folder.videos.findIndex((v) => v.public_id === publicId);
    if (vidIndex !== -1) {
      await cloudinary.uploader.destroy(publicId, { resource_type: "video" });
      folder.videos.splice(vidIndex, 1);
      await folder.save();
      return res.json({ message: "Video deleted successfully", images: folder.images, videos: folder.videos });
    }

    // not found
    return res.status(404).json({ message: "Media not found in folder" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Delete failed", error: err.message });
  }
});

/**
 * PUT /:folderId/:publicId
 * Update metadata or rename resource.
 * Body options:
 * - newName: new public_id (will rename resource on Cloudinary)
 * - newLabel: for images (set label; send empty string to clear)
 * - newTitle: for videos (set title; send empty string to clear)
 *
 * The route will detect whether the publicId belongs to an image or video in this folder.
 */
router.put("/:folderId/:publicId", auth, async (req, res) => {
  try {
    const { folderId } = req.params;
    const publicId = decodeURIComponent(req.params.publicId);
    const { newName, newLabel, newTitle } = req.body;

    const folder = await Folder.findById(folderId);
    if (!folder) return res.status(404).json({ message: "Folder not found" });

    // check images
    let imageIndex = folder.images.findIndex((img) => img.public_id === publicId);
    if (imageIndex !== -1) {
      // rename on cloudinary if requested
      if (newName) {
        const renamed = await cloudinary.uploader.rename(publicId, newName, { resource_type: "image" });
        folder.images[imageIndex].public_id = renamed.public_id;
        folder.images[imageIndex].url = renamed.secure_url;
      }

      if (newLabel !== undefined) {
        folder.images[imageIndex].label = newLabel; // allow empty string
      }

      await folder.save();
      return res.json({ message: "Image updated", image: folder.images[imageIndex] });
    }

    // check videos
    let videoIndex = folder.videos.findIndex((v) => v.public_id === publicId);
    if (videoIndex !== -1) {
      if (newName) {
        const renamed = await cloudinary.uploader.rename(publicId, newName, { resource_type: "video" });
        folder.videos[videoIndex].public_id = renamed.public_id;
        folder.videos[videoIndex].url = renamed.secure_url;
      }

      if (newTitle !== undefined) {
        folder.videos[videoIndex].title = newTitle;
      }

      await folder.save();
      return res.json({ message: "Video updated", video: folder.videos[videoIndex] });
    }

    return res.status(404).json({ message: "Media not found" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Update failed", error: err.message });
  }
});

// PATCH /folders/:folderId/reorder
// body: { imagesOrder: ["public_id1","public_id2",...], videosOrder: ["vidPublicId1", ...] }

router.patch("/:folderId/reorder", auth, async (req, res) => {
  try {
    const { folderId } = req.params;
    const { imagesOrder, videosOrder } = req.body;

    const folder = await Folder.findById(folderId);
    if (!folder) return res.status(404).json({ message: "Folder not found" });

    // reorder images if provided
    if (Array.isArray(imagesOrder)) {
      const map = new Map(folder.images.map(img => [img.public_id, img]));
      const newImages = [];
      for (const pid of imagesOrder) {
        if (map.has(pid)) newImages.push(map.get(pid));
      }
      // optional: append any items that were omitted in imagesOrder at the end
      for (const img of folder.images) if (!imagesOrder.includes(img.public_id)) newImages.push(img);

      folder.images = newImages;
    }

    // reorder videos if provided
    if (Array.isArray(videosOrder)) {
      const mapV = new Map(folder.videos.map(v => [v.public_id, v]));
      const newVideos = [];
      for (const pid of videosOrder) {
        if (mapV.has(pid)) newVideos.push(mapV.get(pid));
      }
      for (const v of folder.videos) if (!videosOrder.includes(v.public_id)) newVideos.push(v);

      folder.videos = newVideos;
    }

    await folder.save();
    return res.json({ message: "Reordered", images: folder.images, videos: folder.videos });
  } catch (err) {
    console.error("Reorder error:", err);
    return res.status(500).json({ message: "Reorder failed", error: err.message });
  }
});

// add to your folders router (same file where you define Folder routes)
router.patch('/reorder-folders', auth, async (req, res) => {
  try {
    const { folderIds } = req.body;
    if (!Array.isArray(folderIds)) {
      return res.status(400).json({ message: 'folderIds array required' });
    }

    // Build bulkWrite ops to set an 'order' field for each folder
    const ops = folderIds.map((id, idx) => ({
      updateOne: {
        filter: { _id: id },
        update: { $set: { order: idx } }
      }
    }));

    if (ops.length > 0) await Folder.bulkWrite(ops);

    // Return the updated folder list sorted by order then createdAt as fallback
    const folders = await Folder.find().sort({ order: 1, createdAt: 1 });
    return res.json({ message: 'Folders reordered', folders });
  } catch (err) {
    console.error('Reorder folders error:', err);
    return res.status(500).json({ message: 'Reorder failed', error: err.message });
  }
});



module.exports = router;


// // routes/images.js
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

// /**
//  * POST /:folderId
//  * - Upload files (multipart/form-data key: "file")
//  * - Optional labels: either labels[] (multiple) or labels (single string)
//  *   Sent in same order as files.
//  */
// router.post("/:folderId", auth, upload.array("file"), async (req, res) => {
//   console.log("FILES RECEIVED:", req.files);
//   console.log("BODY:", req.body);

//   const { folderId } = req.params;
//   try {
//     const folder = await Folder.findById(folderId);
//     if (!folder) return res.status(404).json({ message: "Folder not found" });

//     // Normalize labels: handle labels, labels[] or single string value
//     let labels = req.body.labels ?? req.body["labels[]"];
//     if (labels !== undefined && typeof labels === "string") {
//       // single string -> array with one element
//       labels = [labels];
//     }
//     // If labels is undefined, that's fine (labels optional)

//     const results = [];

//     for (let i = 0; i < (req.files || []).length; i++) {
//       const file = req.files[i];

//       // upload to Cloudinary
//       const uploaded = await cloudinary.uploader.upload(file.path, {
//         folder: `koovappady/${folder.name}`,
//       });

//       const label = Array.isArray(labels) ? labels[i] : labels; // may be undefined

//       const imageObj = {
//         url: uploaded.secure_url,
//         public_id: uploaded.public_id,
//         ...(label !== undefined ? { label } : {}), // only include label when provided
//       };

//       folder.images.push(imageObj);
//       results.push(imageObj);

//       // clean up temp file (safe)
//       try {
//         fs.unlinkSync(file.path);
//       } catch (e) {
//         console.warn("Failed to remove temp file:", file.path, e);
//       }
//     }

//     await folder.save();
//     return res.json({ uploaded: results });
//   } catch (err) {
//     console.error(err);
//     return res.status(500).json({ message: "Upload failed" });
//   }
// });

// /**
//  * GET (authenticated) - returns folder images
//  */
// router.get("/:folderId", auth, async (req, res) => {
//   try {
//     const folder = await Folder.findById(req.params.folderId);
//     if (!folder) return res.status(404).json({ message: "Folder not found" });

//     return res.json({ images: folder.images });
//   } catch (err) {
//     console.error(err);
//     return res.status(500).json({ message: "Could not fetch images" });
//   }
// });

// /**
//  * GET public - returns folder images without auth
//  */
// router.get("/:folderId/public", async (req, res) => {
//   try {
//     const folder = await Folder.findById(req.params.folderId);
//     if (!folder) return res.status(404).json({ message: "Folder not found" });

//     return res.json({ images: folder.images });
//   } catch (err) {
//     console.error(err);
//     return res.status(500).json({ message: "Could not fetch images" });
//   }
// });

// /**
//  * DELETE /:folderId/:publicId
//  * - Deletes image from Cloudinary and removes from folder.images
//  */
// router.delete("/:folderId/:publicId", auth, async (req, res) => {
//   try {
//     const { folderId } = req.params;
//     // publicId may be URL encoded when sent in URL, so decode
//     const publicId = decodeURIComponent(req.params.publicId);

//     const folder = await Folder.findById(folderId);
//     if (!folder) return res.status(404).json({ message: "Folder not found" });

//     // delete from Cloudinary
//     await cloudinary.uploader.destroy(publicId);

//     // remove from DB array
//     folder.images = folder.images.filter((img) => img.public_id !== publicId);
//     await folder.save();

//     return res.json({ message: "Image deleted successfully", images: folder.images });
//   } catch (err) {
//     console.error(err);
//     return res.status(500).json({ message: "Delete failed" });
//   }
// });

// /**
//  * PUT /:folderId/:publicId
//  * - Update metadata for an image:
//  *   - To update label only: send { newLabel: "..." }
//  *   - To rename Cloudinary public_id (and update url): send { newName: "<new_public_id>" }
//  *   - You can send both to rename and update label at once.
//  */
// router.put("/:folderId/:publicId", auth, async (req, res) => {
//   try {
//     const { folderId } = req.params;
//     // decode in case public id was encoded in URL
//     const publicId = decodeURIComponent(req.params.publicId);
//     const { newName, newLabel } = req.body;

//     const folder = await Folder.findById(folderId);
//     if (!folder) return res.status(404).json({ message: "Folder not found" });

//     const imageIndex = folder.images.findIndex((img) => img.public_id === publicId);
//     if (imageIndex === -1) return res.status(404).json({ message: "Image not found" });

//     // If newName provided, rename resource on Cloudinary and update stored public_id + url
//     if (newName) {
//       const renamed = await cloudinary.uploader.rename(publicId, newName);
//       folder.images[imageIndex].public_id = renamed.public_id;
//       folder.images[imageIndex].url = renamed.secure_url;
//     }

//     // Update label if provided (allow empty string to clear label)
//     if (newLabel !== undefined) {
//       folder.images[imageIndex].label = newLabel;
//     }

//     await folder.save();

//     return res.json({ message: "Image updated", image: folder.images[imageIndex] });
//   } catch (err) {
//     console.error(err);
//     return res.status(500).json({ message: "Update failed" });
//   }
// });

// module.exports = router;


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
