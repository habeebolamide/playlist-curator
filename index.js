require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const { createServer } = require("./server");
const { initBot } = require("./bot");

const port = process.env.PORT || 8080;

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });

initBot(bot);

const app = createServer(bot);
app.listen(port, () => {
    console.log(`🌐 Server running on port ${port}`);
});

console.log("🎧 VibeList bot is running...");