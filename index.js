const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors'); // CORS support

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*", // Allow all origins
    methods: ["GET", "POST", "DELETE"]
  }
});

// Enable CORS and JSON parsing
app.use(cors());
app.use(express.json());

// Ensure uploads directory exists
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

// Configure file storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});
const upload = multer({ storage });

// Global state
let globalText = '';
let files = [];

// Socket.io connections
io.on('connection', (socket) => {
  console.log('✅ New client connected:', socket.id);

  // Send initial state
  socket.emit('init', { text: globalText, files });

  // Handle text updates
  socket.on('textUpdate', (text) => {
    globalText = text;
    socket.broadcast.emit('textUpdate', text);
  });

  // Handle file deletion
  socket.on('deleteFile', (filename) => {
    files = files.filter(file => file.filename !== filename);
    io.emit('fileDeleted', filename);
  });

  // Handle deleting all files
  socket.on('deleteAllFiles', () => {
    files = [];
    io.emit('allFilesDeleted');
  });

  // Handle clearing text
  socket.on('clearText', () => {
    globalText = '';
    io.emit('textUpdate', '');
  });

  socket.on('disconnect', () => {
    console.log('❌ Client disconnected:', socket.id);
  });
});

// File upload endpoint
app.post('/upload', upload.single('file'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const fileData = {
      filename: req.file.filename,
      originalname: req.file.originalname,
      timestamp: Date.now(),
      url: `https://air-exchange.onrender.com/uploads/${req.file.filename}`
    };

    files.push(fileData);
    io.emit('newFile', fileData); // Notify clients
    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Upload failed' });
  }
});

// File download endpoint
app.get('/download/:filename', (req, res) => {
  const filename = req.params.filename;
  const filePath = path.join(uploadDir, filename);

  if (fs.existsSync(filePath)) {
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.sendFile(filePath);
  } else {
    res.status(404).json({ error: 'File not found' });
  }
});

// Delete single file endpoint
app.delete('/delete-file/:filename', (req, res) => {
  try {
    const filename = req.params.filename;
    const filePath = path.join(uploadDir, filename);

    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      files = files.filter(file => file.filename !== filename);
      io.emit('fileDeleted', filename);
      res.status(200).json({ success: true });
    } else {
      res.status(404).json({ error: 'File not found' });
    }
  } catch (error) {
    console.error('Delete file error:', error);
    res.status(500).json({ error: 'Delete failed' });
  }
});

// Delete all files endpoint
app.delete('/delete-all', (req, res) => {
  try {
    files.forEach(file => {
      const filePath = path.join(uploadDir, file.filename);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    });
    
    files = [];
    io.emit('allFilesDeleted');
    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Delete all error:', error);
    res.status(500).json({ error: 'Delete all failed' });
  }
});

// Auto-clean old files every 30 minutes
setInterval(() => {
  const now = Date.now();
  files = files.filter(file => {
    if (now - file.timestamp > 1800000) { // 30 minutes
      const filePath = path.join(uploadDir, file.filename);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      return false;
    }
    return true;
  });
}, 1800000);

// Serve uploaded files
app.use('/uploads', express.static(uploadDir));
app.use(express.static(path.join(__dirname, 'public')));

// Start server
const PORT = 3000;
server.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});
