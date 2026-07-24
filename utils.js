const rateLimits = {};
const RATE_LIMIT = 2;
const RATE_WINDOW = 60 * 1000;

function isRateLimited(chatId) {
    const now = Date.now();

    if (!rateLimits[chatId]) {
        rateLimits[chatId] = { count: 0, windowStart: now };
    }

    const userLimit = rateLimits[chatId];

    // Reset window if expired
    if (now - userLimit.windowStart > RATE_WINDOW) {
        userLimit.count = 0;
        userLimit.windowStart = now;
    }

    // Block if over limit
    if (userLimit.count >= RATE_LIMIT) {
        const timeLeft = RATE_WINDOW - (now - userLimit.windowStart);
        const hoursLeft = Math.ceil(timeLeft / (60 * 60 * 1000));
        const minutesLeft = Math.ceil(timeLeft / 60000);
        return {
            limited: true,
            timeLeft: hoursLeft >= 1
                ? `${hoursLeft} hour${hoursLeft > 1 ? "s" : ""}`
                : `${minutesLeft} minute${minutesLeft > 1 ? "s" : ""}`,
        };
    }

    return { limited: false };
}

function incrementRateLimit(chatId) {
    const now = Date.now();
    if (!rateLimits[chatId]) {
        rateLimits[chatId] = { count: 0, windowStart: now };
    }
    rateLimits[chatId].count++;
}

function escapeMarkdown(text) {
    return String(text).replace(/[_*[\]()~`>#+=|{}.!-]/g, "\\$&");
}

function formatPlaylist(tracks, vibe, yearStart, yearEnd) {
    let msg = `🎵 Your ${vibe} Playlist (${yearStart}-${yearEnd})\n\n`;
    tracks.forEach((t, i) => {
        msg += `${i + 1}. ${t.title}\n`;
        msg += `   👤 ${t.artist}\n`;
       const albumDisplay = !t.album || t.album === "Unknown Album"
            ? "Single"
            : t.album.toLowerCase() === t.title.toLowerCase()
            ? "Single"
            : t.album;
        msg += `   💿 ${albumDisplay}${t.year && t.year !== "N/A" ? ` (${t.year})` : ""}\n`;
        // if (t.bpm) {
        //     msg += `   🎚 ${t.bpm} BPM · ${t.key} · Energy ${(t.energy * 100).toFixed(0)}%\n`;
        // }
        msg += "\n";
    });
    return msg;
}

module.exports = { isRateLimited, incrementRateLimit, escapeMarkdown, formatPlaylist, RATE_LIMIT };