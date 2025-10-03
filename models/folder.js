
const mongoose = require('mongoose');

const ImageSchema = new mongoose.Schema({
    url: { type: String, required: true },
    public_id: { type: String },
    createdAt: { type: Date, default: Date.now }
});

const FolderSchema = new mongoose.Schema({
    name: { type: String, required: true },
    images: [ImageSchema],
    createdAt: { type: Date, default: Date.now }
});


module.exports = mongoose.model('Folder', FolderSchema);