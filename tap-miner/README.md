# Blockchain Tap Miner Game

A multiplayer browser-based game that demonstrates blockchain mining concepts through a tapping competition.

## How It Works

1. Players join the game and compete by tapping their screens
2. Each tap generates a new hash
3. The game runs for 2 minutes
4. Winner is determined by finding the hash with most leading zeros
5. Simulates real blockchain mining competition

## Features

- Real-time multiplayer gameplay
- Visual hash generation
- Leading zeros calculation
- Live leaderboard
- Automatic game rounds

## Setup for Development

1. Install dependencies:
```bash
npm install
```

2. Start the server:
```bash
node server.js
```

3. Visit `http://localhost:3001` in your browser

## Deployment

### For Local Network
1. Clone the repository
2. Run `npm install`
3. Start server with `node server.js`
4. Players can connect via local network using your IP address

### For Internet Deployment
1. Deploy to a hosting service (Heroku, DigitalOcean, etc.)
2. Update WebSocket connection URL in `game.js`
3. Configure environment variables if needed

## Technologies Used

- WebSocket for real-time communication
- Express.js for serving static files
- Crypto for hash generation
- HTML5/CSS3 for UI
- JavaScript for game logic

## Game Rules

1. Each player taps to generate hashes
2. More taps = more chances to find good hashes
3. Hashes are sorted by timestamp
4. Winner has hash with most leading zeros
5. New game starts automatically after each round

## Contributing

1. Fork the repository
2. Create your feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request
