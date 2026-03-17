require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const axios = require("axios");

// Initialize clients
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Store user sessions
const userSessions = {};
const rateLimits = {};
const RATE_LIMIT = 3;
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

// ─── Spotify Auth ────────────────────────────────────────────
async function getSpotifyToken() {
    const credentials = Buffer.from(
        `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`
    ).toString("base64");

    const res = await axios.post(
        "https://accounts.spotify.com/api/token",
        "grant_type=client_credentials",
        {
            headers: {
                Authorization: `Basic ${credentials}`,
                "Content-Type": "application/x-www-form-urlencoded",
            },
        }
    );
    return res.data.access_token;
}

// ─── Spotify Track Search ─────────────────────────────────────
async function searchTrack(token, title, artist) {
    try {
        const res = await axios.get("https://api.spotify.com/v1/search", {
            headers: { Authorization: `Bearer ${token}` },
            params: {
                q: `track:${title} artist:${artist}`,
                type: "track",
                limit: 1,
            },
        });

        const track = res.data.tracks.items[0];
        if (!track) return null;

        return {
            title: track.name,
            artist: track.artists.map((a) => a.name).join(", "),
            album: track.album.name,
            year: track.album.release_date.split("-")[0],
            spotifyId: track.id,
        };
    } catch {
        return null;
    }
}

// ─── Spotify Audio Features ───────────────────────────────────
async function getAudioFeatures(token, tracks) {
    try {
        const ids = tracks
            .filter((t) => t?.spotifyId)
            .map((t) => t.spotifyId)
            .join(",");

        if (!ids) return tracks;

        const res = await axios.get("https://api.spotify.com/v1/audio-features", {
            headers: { Authorization: `Bearer ${token}` },
            params: { ids },
        });

        const featuresMap = {};
        res.data.audio_features.forEach((f) => {
            if (f) featuresMap[f.id] = f;
        });

        // Key notation
        const keyNames = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
        const modeNames = ["Minor", "Major"];

        return tracks.map((track) => {
            if (!track?.spotifyId || !featuresMap[track.spotifyId]) return track;
            const f = featuresMap[track.spotifyId];
            return {
                ...track,
                bpm: Math.round(f.tempo),
                key: `${keyNames[f.key]} ${modeNames[f.mode]}`,
                energy: f.energy,
                danceability: f.danceability,
                valence: f.valence,
            };
        });
    } catch {
        return tracks;
    }
}

// ─── Claude/Gemini Initial Playlist ──────────────────────────
async function generatePlaylist(vibe, yearStart, yearEnd, artists, length) {
    const artistLine = artists
        ? `Try to include songs from these artists where it fits: ${artists}.`
        : "";
    const prompt = `You are an expert music curator, DJ and die-hard fan of African music with encyclopedic knowledge of Afrobeats, Afropop, Amapiano, Highlife, Afro-fusion and the Nigerian, Ghanaian and South African music scenes.

You know every era, every artist, every hit. You are deeply familiar with the Nigerian music scene — Wizkid, Davido, Burna Boy, Olamide, Tiwa Savage, Adekunle Gold, Mr Eazi, Fireboy, Rema, Asake, Tems, Ayra Starr, Fela Kuti, 2Baba, P-Square, D'banj, Yemi Alade, Tekno, Runtown and the entire ecosystem around them.

For non-African genres you bring the same depth across Hip Hop, R&B, Dancehall, Reggae and Pop.

Curate a playlist with exactly ${length} songs.

Playlist requirements:
- Genre/Vibe: ${vibe}
- Year range: ${yearStart} to ${yearEnd}
- Length: ${length} songs
${artistLine}

Your priority is always the VIBE first. Every song must serve the mood and flow.
Pick artists and songs that genuinely fit the energy being requested — not just the biggest names.
If the vibe calls for smooth and melodic, pick smooth and melodic songs even from the biggest artists.
If the vibe calls for street and energetic, reflect that.
Think like a real DJ — consider energy arc, BPM transitions, mood flow and how each song leads into the next.
When including an artist, prioritize songs that best represent their core sound and artistic identity, not just their most streamed collaborations.
The playlist should feel intentional from the first song to the last.

Return ONLY a JSON array, no explanation, no markdown, just raw JSON like this:
[
  {"title": "Song Name", "artist": "Artist Name"},
  {"title": "Song Name", "artist": "Artist Name"}
]`;
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    const result = await model.generateContent(prompt);
    const raw = result.response.text().trim();
    const clean = raw.replace(/```json|```/g, "").trim();
    return JSON.parse(clean);
}

// ─── Gemini Refine With Audio Features ───────────────────────
async function refinePlaylist(tracks, vibe, token) {
    const tracksWithFeatures = tracks.filter((t) => t?.bpm);
    if (tracksWithFeatures.length < 3) return { tracks, swapCount: 0 };

    const trackData = tracks
        .map((t, i) =>
            `${i + 1}. "${t.title}" by ${t.artist} | BPM: ${t.bpm || "unknown"} | Key: ${t.key || "unknown"} | Energy: ${t.energy ? t.energy.toFixed(2) : "unknown"} | Danceability: ${t.danceability ? t.danceability.toFixed(2) : "unknown"} | Mood: ${t.valence ? t.valence.toFixed(2) : "unknown"}`
        )
        .join("\n");

    const prompt = `You are a professional DJ curating a ${vibe} playlist.

Here are the songs with their audio features:
${trackData}

Your job:
1. Reorder these songs for the best possible listening experience
2. Identify any songs that are clear vibe breaks — songs whose BPM, energy or mood clashes badly with the surrounding songs and disrupts the flow
3. For each vibe break, suggest a replacement song that fits the ${vibe} genre and matches the energy needed at that point in the playlist

Consider:
- Start with a good energy opener
- Build energy gradually or create intentional peaks and valleys
- Match BPM transitions smoothly (avoid jumping more than 20-30 BPM between consecutive songs)
- Key compatibility for smooth transitions
- Energy (0-1): higher = more intense
- Danceability (0-1): higher = more danceable
- Mood/Valence (0-1): higher = happier, lower = darker
- End on a memorable note

Return ONLY a JSON object, no explanation, no markdown, just raw JSON like this:
{
  "playlist": [
    {"title": "Song Name", "artist": "Artist Name"},
    {"title": "Song Name", "artist": "Artist Name"}
  ],
  "swaps": [
    {"removed": "Song that was replaced", "added": "Song that replaced it"}
  ]
}

If no swaps were needed, return an empty array for swaps.`;

    try {
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const result = await model.generateContent(prompt);
        const raw = result.response.text().trim();
        const clean = raw.replace(/```json|```/g, "").trim();
        const refined = JSON.parse(clean);

        console.log("🔍 Refinement result:", JSON.stringify(refined, null, 2));


        const reordered = refined.playlist;
        const swaps = refined.swaps || [];

        // Enrich any new replacement songs with Spotify data
        const finalTracks = await Promise.all(
            reordered.map(async (r) => {
                // Check if this song already exists in our enriched tracks
                const existing = tracks.find(
                    (t) => t.title.toLowerCase() === r.title.toLowerCase()
                );
                if (existing) return existing;

                // It's a new replacement song — fetch from Spotify
                const newTrack = await searchTrack(token, r.title, r.artist);
                return newTrack || { ...r, album: "Unknown Album", year: "N/A" };
            })
        );

        return { tracks: finalTracks, swapCount: swaps.length };
    } catch {
        return { tracks, swapCount: 0 };
    }
}

// ─── Format Playlist Message ──────────────────────────────────
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

// ─── Conversation Flow ────────────────────────────────────────
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;

    if (isRateLimited(chatId)) {
        bot.sendMessage(
            chatId,
            `⏳ You've hit the limit of ${RATE_LIMIT} playlists per hour. Come back later!`
        );
        return;
    }

    userSessions[chatId] = { step: "vibe" };
    bot.sendMessage(
        chatId,
        `👋 Welcome to *VibeList* — your AI playlist curator!\n\nWhat's the vibe or genre? (e.g. Afrobeats, Road trip, Late night R&B, 90s Hip Hop)`,
    );
});

bot.on("message", async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text?.trim();

    if (!text || text === "/start") return;

    const session = userSessions[chatId];
    if (!session) {
        bot.sendMessage(chatId, `Type /start to create a playlist 🎧`);
        return;
    }

    if (session.step === "vibe") {
        session.vibe = text;
        session.step = "yearStart";
        bot.sendMessage(chatId, `🗓 What year should the playlist start from? (e.g. 2000)`);
        return;
    }

    if (session.step === "yearStart") {
        if (isNaN(text) || text.length !== 4) {
            bot.sendMessage(chatId, `Please enter a valid year like 2000`);
            return;
        }
        session.yearStart = text;
        session.step = "yearEnd";
        bot.sendMessage(chatId, `🗓 What year should it end? (e.g. 2007)`);
        return;
    }

    if (session.step === "yearEnd") {
        if (isNaN(text) || text.length !== 4) {
            bot.sendMessage(chatId, `Please enter a valid year like 2007`);
            return;
        }
        session.yearEnd = text;
        session.step = "artists";
        bot.sendMessage(
            chatId,
            `🎤 Any specific artists to include? (optional — type *skip* to skip)`,
        );
        return;
    }

    if (session.step === "artists") {
        session.artists = text.toLowerCase() === "skip" ? null : text;
        session.step = "length";
        bot.sendMessage(chatId, `📏 How many songs? (e.g. 10, 20, 30)`);
        return;
    }

    if (session.step === "length") {
        const length = parseInt(text);
        if (isNaN(length) || length < 1 || length > 50) {
            bot.sendMessage(chatId, `Please enter a number between 1 and 50`);
            return;
        }

        session.length = length;
        session.step = "done";

        bot.sendMessage(chatId, `⏳ Curating your playlist, hang tight...`);

        try {
            // Step 1 — Gemini suggests songs
            const suggestions = await generatePlaylist(
                session.vibe,
                session.yearStart,
                session.yearEnd,
                session.artists,
                session.length
            );

            // Step 2 — Enrich with Spotify data + audio features
            const token = await getSpotifyToken();
            const enriched = await Promise.all(
                suggestions.map((t) => searchTrack(token, t.title, t.artist))
            );

            // Fallback to Gemini data if Spotify doesn't find track
            const withFallback = enriched.map((spotifyTrack, i) =>
                spotifyTrack || {
                    ...suggestions[i],
                    album: "Unknown Album",
                    year: "N/A",
                }
            );

            // Step 3 — Get audio features
            bot.sendMessage(chatId, `🎚 Analyzing audio features...`);
            const withFeatures = await getAudioFeatures(token, withFallback);

            // Step 4 — Refine playlist order with Gemini
            bot.sendMessage(chatId, `🎛 Optimizing flow and transitions...`);
            const { tracks: refined, swapCount } = await refinePlaylist(
                withFeatures,
                session.vibe,
                token
            );

            // Step 5 — Send final playlist
            const message = formatPlaylist(
                refined,
                session.vibe,
                session.yearStart,
                session.yearEnd
            );

            if (swapCount > 0) {
                bot.sendMessage(
                    chatId,
                    `🔄 ${swapCount} song${swapCount > 1 ? "s were" : " was"} swapped to keep the vibe consistent`
                );
            }

            bot.sendMessage(chatId, message);
            bot.sendMessage(chatId, `🔁 Type /start to generate another playlist`);
        } catch (err) {
            console.error(err);
            bot.sendMessage(
                chatId,
                `Something went wrong generating your playlist. Try /start again.`
            );
        }

        delete userSessions[chatId];
        return;
    }
});

console.log("🎧 VibeList bot is running...");