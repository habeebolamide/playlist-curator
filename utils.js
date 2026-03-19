const rateLimits = {};
const RATE_LIMIT = 3;
const RATE_WINDOW =  60 * 1000;

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
        const minutesLeft = Math.ceil((RATE_WINDOW - (now - userLimit.windowStart)) / 60000);
        return { limited: true, minutesLeft };
    }

    // Increment and allow
    userLimit.count++;
    return { limited: false };
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

module.exports = { isRateLimited, escapeMarkdown, formatPlaylist, RATE_LIMIT };
