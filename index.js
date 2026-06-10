require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const { createServer } = require("./server");
const { initBot } = require("./bot");

const port = process.env.PORT || 8080;

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });

// Polling recovers on its own after network blips — log quietly instead of dumping stack traces
bot.on("polling_error", (err) => {
    console.warn(`⚠️ Telegram polling error (${err.code}) — retrying automatically`);
});

initBot(bot);

const app = createServer(bot);
app.listen(port, () => {
    console.log(`🌐 Server running on port ${port}`);
});

console.log("🎧 VibeList bot is running...");