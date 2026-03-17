const rateLimits = {};
const RATE_LIMIT = 2;
const RATE_WINDOW = 60 * 60 * 1000;

function isRateLimited(chatId) {
    const now = Date.now();
    if (!rateLimits[chatId]) {
        rateLimits[chatId] = { count: 1, windowStart: now };
        return false;
    }
    const userLimit = rateLimits[chatId];
    if (now - userLimit.windowStart > RATE_WINDOW) {
        rateLimits[chatId] = { count: 1, windowStart: now };
        return false;
    }
    if (userLimit.count >= RATE_LIMIT) return true;
    userLimit.count++;
    return false;
}

function escapeMarkdown(text) {
    return String(text).replace(/[_*[\]()~`>#+=|{}.!-]/g, "\\$&");
}

function formatPlaylist(tracks, vibe, yearStart, yearEnd) {
    let msg = `🎵 Your ${vibe} Playlist (${yearStart}-${yearEnd})\n\n`;
    tracks.forEach((t, i) => {
        msg += `${i + 1}. ${t.title}\n`;
        msg += `   👤 ${t.artist}\n`;
        msg += `   💿 ${t.album || "Unknown Album"} (${t.year || "N/A"})\n`;
        if (t.bpm) {
            msg += `   🎚 ${t.bpm} BPM · ${t.key} · Energy ${(t.energy * 100).toFixed(0)}%\n`;
        }
        msg += "\n";
    });
    return msg;
}

module.exports = { isRateLimited, escapeMarkdown, formatPlaylist, RATE_LIMIT };