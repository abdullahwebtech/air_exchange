const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors'); // Add CORS support

const app = express();
app.use(cors()); // Enable CORS
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*", // Allow all origins (you can restrict this to your frontend URL)
    methods: ["GET", "POST", "DELETE"]
  }
});

// Uploads folder setup
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

// File storage configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  }
});
const upload = multer({ storage });

// Global state
let globalText = '';
let files = [];

// Socket.io connection
io.on('connection', (socket) => {
  console.log('✅ New connection:', socket.id);
  
  // Send initial data
  socket.emit('init', { text: globalText, files });
  
  // Handle text updates
  socket.on('textUpdate', (text) => {
    globalText = text;
    socket.broadcast.emit('textUpdate', text); // Broadcast to all clients
  });

  // Handle file deletions
  socket.on('deleteFile', (filename) => {
    files = files.filter(file => file.filename !== filename);
    io.emit('fileDeleted', filename); // Notify all clients
  });

  // Handle all files deletion
  socket.on('deleteAllFiles', () => {
    files = [];
    io.emit('allFilesDeleted'); // Notify all clients
  });

  // Handle clear text
  socket.on('clearText', () => {
    globalText = '';
    io.emit('textUpdate', ''); // Notify all clients to clear text
  });

  // Cleanup
  socket.on('disconnect', () => {
    console.log('❌ Connection closed:', socket.id);
  });
});

// File upload endpoint
app.post('/upload', upload.single('file'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const fileData = {
      filename: req.file.filename,
      originalname: req.file.originalname,
      timestamp: Date.now(),
      url: `https://air-exchange.vercel.app/uploads/${req.file.filename}` // Update URL here
    };
    
    files.push(fileData);
    io.emit('newFile', fileData); // Notify all clients
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

  // Check if file exists
  if (fs.existsSync(filePath)) {
    // Set Content-Disposition header to force download
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.sendFile(filePath);
  } else {
    res.status(404).json({ error: 'File not found' });
  }
});

// Delete all files endpoint
app.delete('/delete-all', (req, res) => {
  try {
    // Delete all files from the filesystem
    files.forEach(file => {
      fs.unlinkSync(path.join(uploadDir, file.filename));
    });
    files = [];
    io.emit('allFilesDeleted'); // Notify all clients
    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Delete all error:', error);
    res.status(500).json({ error: 'Delete all failed' });
  }
});

// Delete single file endpoint
app.delete('/delete-file/:filename', (req, res) => {
  try {
    const filename = req.params.filename;
    // Delete file from filesystem
    fs.unlinkSync(path.join(uploadDir, filename));
    // Remove file from the array
    files = files.filter(file => file.filename !== filename);
    io.emit('fileDeleted', filename); // Notify all clients
    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Delete file error:', error);
    res.status(500).json({ error: 'Delete file failed' });
  }
});

// Auto-clean files every 30 minutes
setInterval(() => {
  const now = Date.now();
  files.forEach((file, index) => {
    if (now - file.timestamp > 1800000) {
      fs.unlink(path.join(uploadDir, file.filename), () => {});
      files.splice(index, 1);
    }
  });
}, 1800000);

// Serve static files
app.use('/uploads', express.static(uploadDir)); // Serve uploaded files
app.use(express.static(path.join(__dirname, 'public'))); // Serve frontend files

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
