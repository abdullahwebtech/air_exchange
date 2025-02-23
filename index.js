const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

// ✅ Ensure Uploads Folder Exists (⚠️ Vercel does not persist storage)
const uploadDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

// ✅ Multer Storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
});
const upload = multer({ storage });

// ✅ Global State (⚠️ Not Persistent in Vercel)
let globalText = "";
let files = [];

// ✅ Upload File Endpoint
app.post("/upload", upload.single("file"), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const fileData = {
      filename: req.file.filename,
      originalname: req.file.originalname,
      timestamp: Date.now(),
      url: `https://${process.env.VERCEL_URL}/uploads/${req.file.filename}`, // ✅ Dynamic URL Fix
    };

    files.push(fileData);
    res.status(200).json({ success: true, file: fileData });
  } catch (error) {
    console.error("Upload error:", error);
    res.status(500).json({ error: "Upload failed" });
  }
});

// ✅ File Download Endpoint
app.get("/download/:filename", (req, res) => {
  const filename = req.params.filename;
  const filePath = path.join(uploadDir, filename);

  if (fs.existsSync(filePath)) {
    res.download(filePath);
  } else {
    res.status(404).json({ error: "File not found" });
  }
});

// ✅ Serve Static Files (⚠️ Vercel Temporary Storage Issue)
app.use("/uploads", express.static(uploadDir));

// ✅ Delete All Files
app.delete("/delete-all", (req, res) => {
  try {
    files.forEach((file) => {
      const filePath = path.join(uploadDir, file.filename);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    });

    files = [];
    res.status(200).json({ success: true });
  } catch (error) {
    console.error("Delete all error:", error);
    res.status(500).json({ error: "Delete all failed" });
  }
});

// ✅ Delete a Single File
app.delete("/delete-file/:filename", (req, res) => {
  try {
    const filename = req.params.filename;
    const filePath = path.join(uploadDir, filename);

    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      files = files.filter((file) => file.filename !== filename);
      res.status(200).json({ success: true });
    } else {
      res.status(404).json({ error: "File not found" });
    }
  } catch (error) {
    console.error("Delete file error:", error);
    res.status(500).json({ error: "Delete file failed" });
  }
});

// ✅ Auto-Cleanup Files Every 30 Minutes
setInterval(() => {
  const now = Date.now();
  files = files.filter((file) => {
    if (now - file.timestamp > 1800000) {
      const filePath = path.join(uploadDir, file.filename);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      return false;
    }
    return true;
  });
}, 1800000);

// ✅ **Export Only `app` (Vercel Fix)**
module.exports = app;
