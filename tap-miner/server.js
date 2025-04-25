const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const crypto = require('crypto');
const path = require('path');

// Simple logging
function log(...args) {
    console.log(new Date().toISOString(), ...args);
}

const app = express();
const server = http.createServer(app);

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// WebSocket server setup
const wss = new WebSocket.Server({ server });

// WebSocket connection handling
wss.on('connection', (ws, req) => {
    log('New client connected from:', req.socket.remoteAddress);
    
    ws.isAlive = true;
    ws.on('pong', () => ws.isAlive = true);
    
    ws.on('error', (error) => {
        log('WebSocket error:', error);
    });
    
    ws.on('close', () => {
        log('Client disconnected');
    });
});

// Keep-alive mechanism
const pingInterval = setInterval(() => {
    wss.clients.forEach((ws) => {
        if (ws.isAlive === false) {
            log('Terminating inactive client');
            return ws.terminate();
        }
        ws.isAlive = false;
        ws.ping();
    });
}, 30000);

wss.on('close', () => {
    clearInterval(pingInterval);
});

// Server and game state
let serverState = {
    isShuttingDown: false,
    connections: 0
};

let gameState = {
    isActive: false,
    startTime: null,
    players: new Map(),
    winner: null,
    targetZeros: 2,
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

// Server settings
const PORT = process.env.PORT || 3001;

// Health check endpoint
app.get('/health', (req, res) => {
    const health = {
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        connections: wss.clients.size,
        game: {
            active: gameState.isActive,
            players: gameState.players.size,
            timeRemaining: gameState.isActive ? 
                Math.max(0, (gameState.startTime + gameState.duration) - Date.now()) : 0
        }
    };
    res.json(health);
});

// Log environment details
log('Environment:', {
    port: PORT,
    nodeEnv: process.env.NODE_ENV,
    railwayUrl: process.env.RAILWAY_STATIC_URL || 'not set'
});

// Graceful shutdown handler
function gracefulShutdown(signal) {
    log(`Received ${signal}`);
    if (serverState.isShuttingDown) return;
    
    serverState.isShuttingDown = true;
    log('Starting graceful shutdown...');

    // Close WebSocket server
    wss.close(() => {
        log('WebSocket server closed.');
        
        // Close HTTP server
        server.close(() => {
            log('HTTP server closed.');
            process.exit(0);
        });
    });

    // Force shutdown after timeout
    setTimeout(() => {
        log('Forcing shutdown after timeout');
        process.exit(1);
    }, 10000);
}

// Handle shutdown signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Start server
server.listen(PORT, () => {
    log(`Server running on port ${PORT}`);
    startNewGame();
});

// Handle errors
server.on('error', (error) => {
    log('Server error:', error);
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
