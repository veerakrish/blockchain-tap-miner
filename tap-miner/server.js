const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

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

// Start server
const PORT = 3001;
server.listen(PORT, () => {
    console.log(`Tap Miner game server running on port ${PORT}`);
    startNewGame();
});
