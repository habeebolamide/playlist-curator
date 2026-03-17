# 🎧 VibeList — AI Playlist Curator Bot

A Telegram bot that curates intelligent, DJ-quality playlists using AI. Describe a vibe, set a year range, and get a perfectly sequenced playlist with real audio analysis powering the transitions.

---

## 🚀 Features

- **AI Curation** — Gemini AI curates playlists with deep knowledge of Afrobeats, Afropop, Amapiano, Hip Hop, R&B and more
- **Audio Intelligence** — Spotify's audio features API provides real BPM, key, energy and danceability data for every track
- **DJ Flow Refinement** — A second AI pass reorders songs and swaps vibe-breaking tracks for smooth transitions
- **Spotify Export** — OAuth-powered export directly to the user's Spotify account *(in progress)*
- **Rate Limiting** — 3 playlists per user per hour to prevent abuse
- **Year Validation** — Warns users when selecting future years to avoid AI hallucinations

---

## 🛠 Tech Stack

| Layer | Tool |
|---|---|
| Interface | Telegram Bot |
| Bot Framework | node-telegram-bot-api |
| AI Curation | Google Gemini 2.5 Flash |
| AI Refinement | Google Gemini 1.5 Flash |
| Music Data | Spotify Web API |
| Server | Express.js |
| Hosting | Render |

---

## 📁 Project Structure

```
vibelistbot/
├── index.js        # Entry point — initializes bot and server
├── bot.js          # Telegram conversation flow
├── server.js       # Express server + Spotify OAuth routes
├── spotify.js      # Spotify API functions
├── gemini.js       # AI playlist generation and refinement
├── utils.js        # Rate limiting, formatting helpers
├── store.js        # Shared in-memory state
└── .env            # Environment variables
```

---

## ⚙️ How It Works

```
User describes vibe →
Bot asks year range, optional artists, length →
Gemini curates initial playlist →
Spotify enriches each track with album, year, URI →
Spotify audio features API fetches BPM, key, energy →
Gemini refines order and swaps vibe-breaking tracks →
User receives final DJ-quality playlist →
Optional: Export directly to Spotify
```

---

## 🔧 Setup

### Prerequisites
- Node.js v18+
- Telegram Bot Token (via @BotFather)
- Google Gemini API Key (via aistudio.google.com)
- Spotify Developer App (via developer.spotify.com)

### Installation

```bash
git clone https://github.com/yourusername/vibelistbot
cd vibelistbot
npm install
```

### Environment Variables

Create a `.env` file in the root:

```env
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
GEMINI_API_KEY=your_gemini_api_key
SPOTIFY_CLIENT_ID=your_spotify_client_id
SPOTIFY_CLIENT_SECRET=your_spotify_client_secret
SPOTIFY_REDIRECT_URI=https://your-domain.com/callback
BASE_URL=https://your-domain.com
SESSION_SECRET=your_session_secret
PORT=8080
```

### Run Locally

```bash
node index.js
```

For local Spotify OAuth testing, use ngrok:

```bash
ngrok http 8080
```

Update `SPOTIFY_REDIRECT_URI` and `BASE_URL` in `.env` with your ngrok URL.

---

## 📦 Dependencies

```bash
npm install node-telegram-bot-api @google/generative-ai axios express express-session dotenv
```

---

## 🎮 Bot Commands

| Command | Description |
|---|---|
| `/start` | Begin playlist generation |

### Conversation Flow

1. **Vibe/Genre** — e.g. `Afrobeats`, `Late night R&B`, `Street & Smooth`
2. **Start Year** — e.g. `2000`
3. **End Year** — e.g. `2024`
4. **Artists** (optional) — e.g. `Wizkid, Burna Boy` or `skip`
5. **Length** — number of songs between 1-50

---

## 🚢 Deployment (Render)

1. Push code to GitHub
2. Create a new **Web Service** on Render
3. Connect your GitHub repo
4. Add all environment variables in Render dashboard
5. Set start command: `node index.js`
6. Add your Render URL to Spotify app redirect URIs

---

## ⚠️ Known Issues

- **Spotify Export 403** — Spotify app currently in Development Mode. Only whitelisted users can authenticate. Pending Spotify quota extension approval to go fully public.
- **Unknown Album (N/A)** — Some tracks not found in Spotify catalog fall back to AI metadata. Fix planned for V2.
- **Year Range > 2024** — AI may hallucinate song titles for very recent or future years. Bot warns users and requires confirmation to proceed.

---

## 🗺 Roadmap

- Telegram bot with full conversation flow
- AI playlist curation (Gemini)
- Spotify track enrichment
- Audio features analysis (BPM, key, energy)
- DJ flow refinement with song swapping
- Rate limiting
- Modular codebase


---

## 👥 Contributing

This is currently in private beta testing among friends. Public launch coming soon.

---

## 📄 License

MIT

---

*Built in one midnight session. Powered by vibes.* 🌙