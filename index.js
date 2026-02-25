const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] },
    pingTimeout: 60000,
    pingInterval: 25000
});

const PORT = 3000;

// === ГЛОБАЛЬНОЕ СОСТОЯНИЕ ===
const globalState = {
    display: '0',
    audio: { isPlaying: false, currentTime: 0, volume: 50, speed: 1, pitch: 0 },
    partyMode: false,
    users: {}
};

app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

io.on('connection', (socket) => {
    const userId = socket.id;
    const userColor = `hsl(${Math.random() * 360}, 100%, 60%)`;
    const userName = `User_${Math.floor(Math.random() * 1000)}`;

    console.log(`🔌 Подключился: ${userId}`);

    // Добавляем пользователя
    globalState.users[userId] = {
        id: userId, name: userName, color: userColor,
        connectedAt: Date.now(), lastActive: Date.now()
    };

    // Отправляем состояние новому юзеру
    socket.emit('sync:full', { state: globalState, users: globalState.users });
    io.emit('user:joined', { userId, name: userName, color: userColor, users: globalState.users });

    // === КАЛЬКУЛЯТОР ===
    socket.on('calc:input', (value) => {
        globalState.users[userId].lastActive = Date.now();
        if (globalState.display === '0' && value !== '.') globalState.display = value;
        else globalState.display += value;
        io.emit('calc:update', { display: globalState.display, userId, color: userColor });
    });

    socket.on('calc:calculate', (expr) => {
        globalState.users[userId].lastActive = Date.now();
        try {
            const cleanExpr = expr.replace(/[^0-9+\-*/.]/g, '');
            globalState.display = String(Function('"use strict";return (' + cleanExpr + ')')());
        } catch (e) { globalState.display = 'Error'; }
        io.emit('calc:update', { display: globalState.display, userId, color: userColor, isResult: true });
    });

    socket.on('calc:clear', () => {
        globalState.users[userId].lastActive = Date.now();
        globalState.display = '0';
        io.emit('calc:update', { display: globalState.display, userId, color: userColor });
    });

    // === АУДИО ===
    socket.on('audio:play', (data) => {
        globalState.audio.isPlaying = true;
        globalState.audio.currentTime = data.currentTime || 0;
        io.emit('audio:sync', { action: 'play', currentTime: data.currentTime || 0, userId, color: userColor });
    });
    socket.on('audio:pause', () => {
        globalState.audio.isPlaying = false;
        io.emit('audio:sync', { action: 'pause', userId, color: userColor });
    });
    socket.on('audio:volume', (volume) => {
        globalState.audio.volume = volume;
        io.emit('audio:sync', { action: 'volume', volume, userId, color: userColor });
    });
    socket.on('audio:progress', (currentTime) => {
        globalState.audio.currentTime = currentTime;
        io.emit('audio:sync', { action: 'progress', currentTime, userId, color: userColor });
    });
    socket.on('audio:speed', (speed) => {
        globalState.audio.speed = speed;
        io.emit('audio:sync', { action: 'speed', speed, userId, color: userColor });
    });
    socket.on('audio:pitch', (pitch) => {
        globalState.audio.pitch = pitch;
        io.emit('audio:sync', { action: 'pitch', pitch, userId, color: userColor });
    });

    socket.on('party:toggle', (isParty) => {
        globalState.partyMode = isParty;
        io.emit('party:sync', { isParty, userId, color: userColor });
    });

    // === ЧАТ: ОБЩИЙ ===
    socket.on('chat:global', (message) => {
        io.emit('chat:global', {
            userId,
            name: globalState.users[userId]?.name || 'Unknown',
            color: globalState.users[userId]?.color || '#fff',
            message,
            timestamp: Date.now()
        });
    });

    // === ЧАТ: ЛИЧНЫЙ ===
    socket.on('chat:private', (data) => {
        // data = { to: userId, message: text }
        const sender = globalState.users[userId];
        if (sender && data.to) {
            // Отправляем получателю
            io.to(data.to).emit('chat:private', {
                from: userId,
                fromName: sender.name,
                fromColor: sender.color,
                message: data.message,
                timestamp: Date.now(),
                isMe: false
            });
            // Отправляем подтверждение отправителю (чтобы отобразить у себя)
            socket.emit('chat:private', {
                from: userId,
                fromName: sender.name,
                fromColor: sender.color,
                message: data.message,
                timestamp: Date.now(),
                isMe: true
            });
        }
    });

    socket.on('heartbeat', () => {
        if (globalState.users[userId]) globalState.users[userId].lastActive = Date.now();
    });

    socket.on('disconnect', () => {
        console.log(`❌ Отключился: ${userId}`);
        delete globalState.users[userId];
        io.emit('user:left', { userId, users: globalState.users });
    });
});

// Очистка неактивных
setInterval(() => {
    const now = Date.now();
    for (const userId in globalState.users) {
        if (now - globalState.users[userId].lastActive > 120000) {
            delete globalState.users[userId];
            io.emit('user:left', { userId, users: globalState.users });
        }
    }
}, 60000);

server.listen(PORT, () => {
    console.log(`\n🚀 СЕРВЕР ЗАПУЩЕН! http://localhost:${PORT}`);
    console.log(`💬 Чат и перетаскивание активированы!\n`);
});
