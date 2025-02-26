const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST", "DELETE"]
  }
});

const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});
const upload = multer({ storage });

const roomData = new Map();

io.on('connection', (socket) => {
  let room;

  socket.on('joinRoom', ({ roomId, clientId }) => {
    room = `wifi-${roomId}`;
    socket.join(room);
    console.log(`✅ ${clientId} joined room: ${room}`);

    if (!roomData.has(room)) {
      roomData.set(room, { text: '', files: [], expiry: 1800000, users: new Set(), savedTexts: [] });
    }
    const data = roomData.get(room);
    data.users.add(clientId);
    const userCount = data.users.size;
    io.to(room).emit('userCountUpdate', userCount);
    socket.emit('init', data);
    console.log(`Sent init data to ${clientId}:`, { ...data, users: data.users.size });
  });

  socket.on('textUpdate', (formattedText) => {
    if (!room) return;
    roomData.get(room).text = formattedText;
    roomData.get(room).lastTextUpdate = Date.now();
    socket.to(room).emit('textUpdate', formattedText);
    console.log(`Formatted text updated in ${room}: ${formattedText.slice(0, 20)}...`);
  });

  socket.on('deleteFile', (filename) => {
    if (!room) return;
    const roomFiles = roomData.get(room).files;
    roomData.get(room).files = roomFiles.filter(file => file.filename !== filename);
    io.to(room).emit('fileDeleted', filename);
    console.log(`File deleted in ${room}: ${filename}`);
  });

  socket.on('deleteAllFiles', () => {
    if (!room) return;
    roomData.get(room).files = [];
    io.to(room).emit('allFilesDeleted');
    io.to(room).emit('notification', { message: 'All files deleted' });
    console.log(`All files deleted in ${room}`);
  });

  socket.on('clearText', () => {
    if (!room) return;
    roomData.get(room).text = '';
    io.to(room).emit('clearText');
    console.log(`Text cleared in ${room}`);
  });

  socket.on('setExpiry', ({ roomId, expiryTime }) => {
    const room = `wifi-${roomId}`;
    if (roomData.has(room)) {
      roomData.get(room).expiry = expiryTime;
      io.to(room).emit('expiryUpdate', expiryTime);
      console.log(`Expiry set for ${room}: ${expiryTime}ms`);
    }
  });

  socket.on('cursorUpdate', (position) => {
    if (!room) return;
    socket.to(room).emit('cursorUpdate', { id: socket.id, position });
  });

  socket.on('saveText', (savedText) => {
    if (!room) return;
    roomData.get(room).savedTexts.push(savedText);
    io.to(room).emit('savedText', savedText);
    console.log(`Text saved in ${room}: ${savedText.text.slice(0, 20)}...`);
  });

  socket.on('deleteSavedText', (index) => {
    if (!room) return;
    roomData.get(room).savedTexts.splice(index, 1);
    io.to(room).emit('deleteSavedText', index);
    console.log(`Text deleted from ${room} at index ${index}`);
  });

  socket.on('disconnect', () => {
    if (room && roomData.has(room)) {
      const data = roomData.get(room);
      data.users.delete(socket.id);
      const userCount = data.users.size;
      io.to(room).emit('userCountUpdate', userCount);
      console.log(`❌ ${socket.id} disconnected from room: ${room}`);
      if (data.users.size === 0 && data.files.length === 0 && data.text === '' && data.savedTexts.length === 0) {
        roomData.delete(room);
        console.log(`🧹 Cleaned up room: ${room}`);
      }
    }
  });
});

app.post('/upload', upload.single('file'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const roomId = req.headers['x-room-id'];
    if (!roomId) return res.status(400).json({ error: 'Room ID required' });

    const room = `wifi-${roomId}`;
    if (!roomData.has(room)) {
      roomData.set(room, { text: '', files: [], expiry: 1800000, users: new Set(), savedTexts: [] });
    }

    const fileData = {
      filename: req.file.filename,
      originalname: req.file.originalname,
      timestamp: Date.now(),
      url: `https://air-exchange.onrender.com/uploads/${req.file.filename}`
    };

    roomData.get(room).files.push(fileData);
    io.to(room).emit('newFile', fileData);
    io.to(room).emit('notification', { message: `New file uploaded: ${fileData.originalname}` });
    res.status(200).json({ success: true });
    console.log(`File uploaded in ${room}: ${fileData.originalname}`);
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Upload failed' });
  }
});

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

app.delete('/delete-all', (req, res) => {
  try {
    const roomId = req.headers['x-room-id'];
    if (!roomId) return res.status(400).json({ error: 'Room ID required' });
    const room = `wifi-${roomId}`;
    if (!roomData.has(room)) return res.status(404).json({ error: 'Room not found' });

    roomData.get(room).files.forEach(file => fs.unlinkSync(path.join(uploadDir, file.filename)));
    roomData.get(room).files = [];
    io.to(room).emit('allFilesDeleted');
    io.to(room).emit('notification', { message: 'All files deleted' });
    res.status(200).json({ success: true });
    console.log(`All files deleted in ${room}`);
  } catch (error) {
    console.error('Delete all error:', error);
    res.status(500).json({ error: 'Delete all failed' });
  }
});

app.delete('/delete-file/:filename', (req, res) => {
  try {
    const filename = req.params.filename;
    const roomId = req.headers['x-room-id'];
    if (!roomId) return res.status(400).json({ error: 'Room ID required' });
    const room = `wifi-${roomId}`;
    if (!roomData.has(room)) return res.status(404).json({ error: 'Room not found' });

    fs.unlinkSync(path.join(uploadDir, filename));
    roomData.get(room).files = roomData.get(room).files.filter(file => file.filename !== filename);
    io.to(room).emit('fileDeleted', filename);
    io.to(room).emit('notification', { message: `File deleted: ${filename}` });
    res.status(200).json({ success: true });
    console.log(`File deleted in ${room}: ${filename}`);
  } catch (error) {
    console.error('Delete file error:', error);
    res.status(500).json({ error: 'Delete file failed' });
  }
});

setInterval(() => {
  const now = Date.now();
  roomData.forEach((data, room) => {
    const expiryTime = data.expiry || 1800000;
    if (data.files.some(file => now - file.timestamp > expiryTime) || 
        (data.text && now - (data.lastTextUpdate || 0) > expiryTime) || 
        data.savedTexts.some(text => now - text.timestamp > text.expiry)) {
      data.files = data.files.filter(file => now - file.timestamp <= expiryTime);
      data.savedTexts = data.savedTexts.filter(text => now - text.timestamp <= text.expiry);
      if (now - (data.lastTextUpdate || 0) > expiryTime) {
        data.text = '';
        io.to(room).emit('clearText');
      }
      if (data.files.length === 0 && data.text === '' && data.users.size === 0 && data.savedTexts.length === 0) {
        roomData.delete(room);
        console.log(`🧹 Cleaned up room: ${room}`);
      } else {
        io.to(room).emit('init', data);
      }
    }
  });
}, 60000);

app.use('/uploads', express.static(uploadDir));
app.use(express.static(path.join(__dirname, 'public')));
// Start server
const PORT = process.env.PORT || 3000; // Render ke liye dynamic port use karega

server.listen(PORT, () => {
  console.log(`🚀 Server running at https://air-exchange.onrender.com`);
});



// https://air-exchange.onrender.com