const mongoose = require("mongoose");

const ImageSchema = new mongoose.Schema({
  url: { type: String, required: true },
  label: { type: String },
  public_id: { type: String },
  createdAt: { type: Date, default: Date.now },
});

const VideoSchema = new mongoose.Schema({
  url: { type: String, required: true },
  title: { type: String }, // optional metadata field for videos
  public_id: { type: String },
  createdAt: { type: Date, default: Date.now },
});

const FolderSchema = new mongoose.Schema({
  name: { type: String, required: true },
  images: [ImageSchema],
  videos: [VideoSchema],
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("Folder", FolderSchema);
