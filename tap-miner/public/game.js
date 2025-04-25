class TapMinerGame {
    constructor() {
        this.ws = null;
        this.playerName = '';
        this.connected = false;
        this.gameStarted = false;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        
        // Debug mode
        this.debug = true;
        this.log = (...args) => this.debug && console.log(new Date().toISOString(), ...args);
    }
    constructor() {
        this.ws = null;
        this.playerId = null;
        this.playerName = null;
        this.tapCount = 0;
        this.gameActive = false;
        this.gameEndTime = null;
        this.timerInterval = null;

        this.initializeElements();
        this.attachEventListeners();
    }

    initializeElements() {
        // Screens
        this.loginScreen = document.getElementById('login-screen');
        this.gameScreen = document.getElementById('game-screen');
        this.winnerAnnouncement = document.getElementById('winner-announcement');

        // Login elements
        this.playerNameInput = document.getElementById('player-name');
        this.joinButton = document.getElementById('join-btn');

        // Game elements
        this.playerDisplay = document.getElementById('player-display');
        this.playerCount = document.getElementById('player-count');
        this.countdown = document.getElementById('countdown');
        this.tapCounter = document.getElementById('tap-counter');
        this.currentHash = document.getElementById('current-hash');
        this.zeroCount = document.getElementById('zero-count');
        this.hashList = document.getElementById('hash-list');
        this.tapArea = document.getElementById('tap-area');
        this.nextGameCountdown = document.getElementById('next-game-countdown');
        this.winnerDetails = document.getElementById('winner-details');
        this.gameStatus = document.getElementById('game-status');
    }

    attachEventListeners() {
        this.joinButton.addEventListener('click', () => this.joinGame());
        this.tapArea.addEventListener('click', () => this.handleTap());
        this.playerNameInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.joinGame();
        });
    }

    connectWebSocket() {
        if (this.ws) {
            this.ws.close();
        }

        // Use secure WebSocket in production
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const isProduction = window.location.hostname.includes('railway.app');
        const port = isProduction ? '' : ':3001';
        
        const wsUrl = `${protocol}//${window.location.hostname}${port}`;
        console.log('Connecting to WebSocket:', wsUrl);
        
        try {
            this.ws = new WebSocket(wsUrl);
            
            this.ws.onopen = () => {
                console.log('Connected to game server');
                document.getElementById('game-status').textContent = 'Connected';
                document.getElementById('game-status').className = 'connected';
                this.connected = true;
                this.gameStatus.textContent = 'Connected';
            };
            
            this.ws.onclose = () => {
                console.log('Disconnected from game server');
                document.getElementById('game-status').textContent = 'Disconnected';
                document.getElementById('game-status').className = 'error';
                setTimeout(() => this.connectWebSocket(), 3000);
            };
            
            this.ws.onerror = (error) => {
                console.error('WebSocket error:', error);
                document.getElementById('game-status').textContent = 'Connection Error';
                document.getElementById('game-status').className = 'error';
            };
        } catch (error) {
            console.error('Failed to create WebSocket:', error);
            document.getElementById('game-status').textContent = 'Connection Failed';
            document.getElementById('game-status').className = 'error';
            setTimeout(() => this.connectWebSocket(), 3000);
        }
        
        this.ws.onmessage = (event) => {
            this.handleMessage(event);
        };

        this.ws.onclose = () => {
            console.log('Disconnected from server');
            this.connected = false;
            this.gameStatus.textContent = 'Disconnected';
            this.handleConnectionError();
        };
    }

    joinGame() {
        const name = this.playerNameInput.value.trim();
        if (name) {
            this.playerName = name;
            this.log('Starting game for player:', name);
            this.loginScreen.style.display = 'none';
            this.gameScreen.style.display = 'block';
            this.connectWebSocket();
            
            // Show loading state
            this.gameStatus.textContent = 'Connecting...';
        } else {
            alert('Please enter your name to start!');
        }
    }

    handleTap() {
        if (!this.gameActive) return;
        
        if (!this.connected) {
            this.log('Cannot tap: not connected');
            return;
        }
        
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({
                type: 'tap',
                playerName: this.playerName
            }));
        } else {
            this.log('Cannot tap: WebSocket not ready');
            this.handleConnectionError();
        }
        
        this.tapCount++;
        this.tapCounter.textContent = this.tapCount;
        
        this.ws.send(JSON.stringify({
            type: 'tap',
            tapCount: this.tapCount
        }));
    }

    handleServerMessage(message) {
        switch (message.type) {
            case 'joined':
                this.playerId = message.playerId;
                this.gameActive = message.gameActive;
                if (message.gameActive) {
                    this.startGame(message.startTime, message.duration);
                }
                this.showGameScreen();
                break;

            case 'gameStart':
                this.startGame(message.startTime, 120000);
                this.hideWinnerAnnouncement();
                break;

            case 'gameEnd':
                this.endGame(message.winner);
                break;

            case 'playerJoined':
                this.playerCount.textContent = message.playerCount;
                this.addSystemMessage(`${message.playerName} joined the game`);
                break;

            case 'playerLeft':
                this.playerCount.textContent = message.playerCount;
                break;

            case 'newHash':
                this.addHashToFeed(message);
                if (message.playerId === this.playerId) {
                    this.currentHash.textContent = message.hash;
                    this.zeroCount.textContent = message.leadingZeros;
                }
                break;
        }
    }

    startGame(startTime, duration) {
        this.gameActive = true;
        this.gameEndTime = startTime + duration;
        this.tapCount = 0;
        this.tapCounter.textContent = '0';
        this.currentHash.textContent = '-';
        this.zeroCount.textContent = '0';
        this.hashList.innerHTML = '';
        
        clearInterval(this.timerInterval);
        this.updateTimer();
        this.timerInterval = setInterval(() => this.updateTimer(), 1000);
    }

    endGame(winner) {
        this.gameActive = false;
        clearInterval(this.timerInterval);
        this.showWinnerAnnouncement(winner);
        
        // Start countdown for next game
        let countdown = 10;
        this.nextGameCountdown.textContent = countdown;
        const nextGameInterval = setInterval(() => {
            countdown--;
            this.nextGameCountdown.textContent = countdown;
            if (countdown <= 0) {
                clearInterval(nextGameInterval);
            }
        }, 1000);
    }

    updateTimer() {
        const now = Date.now();
        const remaining = Math.max(0, this.gameEndTime - now);
        
        if (remaining === 0) {
            clearInterval(this.timerInterval);
            return;
        }

        const minutes = Math.floor(remaining / 60000);
        const seconds = Math.floor((remaining % 60000) / 1000);
        this.countdown.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
    }

    showGameScreen() {
        this.loginScreen.classList.add('hidden');
        this.gameScreen.classList.remove('hidden');
        this.playerDisplay.textContent = this.playerName;
    }

    showWinnerAnnouncement(winner) {
        this.winnerAnnouncement.classList.remove('hidden');
        if (winner) {
            this.winnerDetails.innerHTML = `
                <div>Winner: ${winner.playerName}</div>
                <div>Leading Zeros: ${winner.leadingZeros}</div>
                <div class="winning-hash">${winner.hash}</div>
            `;
        } else {
            this.winnerDetails.innerHTML = '<div>No winner this round!</div>';
        }
    }

    hideWinnerAnnouncement() {
        this.winnerAnnouncement.classList.add('hidden');
    }

    addHashToFeed(hash) {
        const hashElement = document.createElement('div');
        hashElement.className = 'hash-item';
        hashElement.innerHTML = `
            <div class="player-name">${hash.playerName}</div>
            <div class="hash-value">${hash.hash}</div>
            <div class="zeros">Leading zeros: ${hash.leadingZeros}</div>
        `;
        this.hashList.insertBefore(hashElement, this.hashList.firstChild);
        
        // Keep only last 20 hashes
        while (this.hashList.children.length > 20) {
            this.hashList.removeChild(this.hashList.lastChild);
        }
    }

    addSystemMessage(message) {
        const messageElement = document.createElement('div');
        messageElement.className = 'hash-item system-message';
        messageElement.textContent = message;
        this.hashList.insertBefore(messageElement, this.hashList.firstChild);
    }
}

// Start the game when the page loads
window.onload = () => {
    new TapMinerGame();
};
