const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const crypto = require('crypto');
const path = require('path');

// Enable debug logging
const DEBUG = true;
function log(...args) {
    if (DEBUG) console.log(new Date().toISOString(), ...args);
}

// Track server state
let isShuttingDown = false;

const app = express();
const server = http.createServer(app);

// Serve static files with caching
app.use(express.static(path.join(__dirname, 'public'), {
    maxAge: '1h',
    etag: true,
    lastModified: true
}));

// Basic security headers
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    next();
});

// Enable WebSocket server with client tracking
const wss = new WebSocket.Server({ 
    server,
    // Enable ping/pong heartbeat
    clientTracking: true,
    heartbeat: true
});

// Serve static files
app.use(express.static('public'));

// Game state
let gameState = {
    isActive: false,
    players: new Map(),
    hashes: [],
    startTime: null,
    duration: 120000 // 2 minutes in milliseconds
};

// Helper function to calculate leading zeros
function countLeadingZeros(hash) {
    for (let i = 0; i < hash.length; i++) {
        if (hash[i] !== '0') {
            return i;
        }
    }
    return hash.length;
}

// Start a new game
function startNewGame() {
    gameState.isActive = true;
    gameState.players.clear();
    gameState.hashes = [];
    gameState.startTime = Date.now();

    // Broadcast game start
    broadcast({ type: 'gameStart', startTime: gameState.startTime });

    // End game after duration
    setTimeout(() => endGame(), gameState.duration);
}

// End the game and determine winner
function endGame() {
    gameState.isActive = false;

    // Sort hashes by timestamp
    gameState.hashes.sort((a, b) => a.timestamp - b.timestamp);

    // Find hash with most leading zeros
    let winner = null;
    let maxZeros = -1;

    for (const hash of gameState.hashes) {
        const zeros = countLeadingZeros(hash.hash);
        if (zeros > maxZeros) {
            maxZeros = zeros;
            winner = hash;
        }
    }

    // Broadcast results
    broadcast({
        type: 'gameEnd',
        winner: winner ? {
            playerId: winner.playerId,
            playerName: gameState.players.get(winner.playerId),
            hash: winner.hash,
            leadingZeros: maxZeros
        } : null,
        allHashes: gameState.hashes
    });

    // Schedule next game in 10 seconds
    setTimeout(() => startNewGame(), 10000);
}

// Broadcast to all connected clients
function broadcast(message) {
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(message));
        }
    });
}

// WebSocket connection handling
wss.on('connection', (ws) => {
    const playerId = crypto.randomBytes(8).toString('hex');
    
    ws.on('message', (message) => {
        const data = JSON.parse(message);

        switch (data.type) {
            case 'join':
                gameState.players.set(playerId, data.playerName);
                ws.send(JSON.stringify({
                    type: 'joined',
                    playerId: playerId,
                    gameActive: gameState.isActive,
                    startTime: gameState.startTime,
                    duration: gameState.duration
                }));
                broadcast({
                    type: 'playerJoined',
                    playerId: playerId,
                    playerName: data.playerName,
                    playerCount: gameState.players.size
                });
                break;

            case 'tap':
                if (gameState.isActive) {
                    const timestamp = Date.now();
                    const hash = crypto.createHash('sha256')
                        .update(`${playerId}${timestamp}${data.tapCount}`)
                        .digest('hex');
                    
                    gameState.hashes.push({
                        playerId,
                        playerName: gameState.players.get(playerId),
                        hash,
                        timestamp,
                        tapCount: data.tapCount
                    });

                    // Broadcast new hash
                    broadcast({
                        type: 'newHash',
                        playerId,
                        playerName: gameState.players.get(playerId),
                        hash,
                        leadingZeros: countLeadingZeros(hash)
                    });
                }
                break;
        }
    });

    ws.on('close', () => {
        gameState.players.delete(playerId);
        broadcast({
            type: 'playerLeft',
            playerId: playerId,
            playerCount: gameState.players.size
        });
    });
});

// Production settings
const PORT = process.env.PORT || 3001;
const PRODUCTION = process.env.RAILWAY_STATIC_URL ? true : false;

// Verify environment
if (!path.join(__dirname, 'public')) {
    console.error('Error: Public directory not found');
    process.exit(1);
}

// Keep alive ping interval
const PING_INTERVAL = 30000; // 30 seconds
const PING_TIMEOUT = 5000;  // 5 seconds timeout

console.log('Environment:', {
    PORT: PORT,
    PRODUCTION: PRODUCTION,
    NODE_ENV: process.env.NODE_ENV,
    RAILWAY_STATIC_URL: process.env.RAILWAY_STATIC_URL
});

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// Enhanced health check endpoint
app.get('/health', (req, res) => {
    const health = {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        connections: {
            total: wss.clients.size,
            active: Array.from(wss.clients).filter(client => client.isAlive).length
        }
    };
    res.status(200).json(health);
});

// Graceful shutdown function
function gracefulShutdown(signal) {
    if (isShuttingDown) {
        return;
    }
    
    isShuttingDown = true;
    log(`Received ${signal}. Starting graceful shutdown...`);

    // Notify all clients
    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({
                type: 'system',
                message: 'Server is shutting down...'
            }));
        }
    });

    // Close WebSocket server
    wss.close(() => {
        log('WebSocket server closed.');
        
        // Close HTTP server
        server.close(() => {
            log('HTTP server closed.');
            process.exit(0);
        });

        // Force close after 10 seconds
        setTimeout(() => {
            log('Forcing shutdown after timeout');
            process.exit(1);
        }, 10000);
    });
}

// Start server
server.listen(PORT, '0.0.0.0', () => {
    log(`Tap Miner game server running on port ${PORT} in ${PRODUCTION ? 'production' : 'development'} mode`);
    log('Server configuration:', {
        port: PORT,
        production: PRODUCTION,
        nodeEnv: process.env.NODE_ENV,
        publicPath: path.join(__dirname, 'public')
    });
    startNewGame();
});

// Handle shutdown signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Keep track of connections
server.on('connection', (socket) => {
    socket.on('error', (err) => {
        log('Socket error:', err);
    });
});

// Handle WebSocket errors
wss.on('error', (err) => {
    log('WebSocket server error:', err);
});

// Error handling
server.on('error', (error) => {
    console.error('Server error:', error);
});

process.on('uncaughtException', (error) => {
    console.error('Uncaught exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Implement WebSocket heartbeat
function heartbeat() {
    this.isAlive = true;
}

wss.on('connection', (ws) => {
    ws.isAlive = true;
    ws.on('pong', heartbeat);
});

// Check for stale connections every 30 seconds
const interval = setInterval(() => {
    wss.clients.forEach((ws) => {
        if (ws.isAlive === false) {
            return ws.terminate();
        }
        ws.isAlive = false;
        ws.ping();
    });
}, 30000);
