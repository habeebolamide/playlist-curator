const { createHttpClient } = require("./http");

// Don't hang forever on a dead connection; errors are credential-redacted
const http = createHttpClient(10000);

// Transient network failures worth retrying — the request never reached the server
const RETRYABLE_CODES = new Set([
    "ETIMEDOUT",
    "ECONNABORTED",
    "ECONNRESET",
    "ECONNREFUSED",
    "EAI_AGAIN",
    "ENETUNREACH",
    "ENETDOWN",
]);

function isNetworkError(err) {
    return !err.response && (RETRYABLE_CODES.has(err.code) || RETRYABLE_CODES.has(err.cause?.code));
}

async function withRetry(fn, retries = 2) {
    for (let attempt = 0; ; attempt++) {
        try {
            return await fn();
        } catch (err) {
            if (attempt >= retries || !isNetworkError(err)) throw err;
            const delay = 1000 * (attempt + 1);
            console.warn(`⚠️ Network error (${err.code}), retrying in ${delay / 1000}s...`);
            await new Promise((resolve) => setTimeout(resolve, delay));
        }
    }
}

// The client secret is only ever read inside this function — never logged, never
// passed around. All token grants go through here.
async function requestToken(body) {
    const credentials = Buffer.from(
        `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`
    ).toString("base64");

    const res = await withRetry(() =>
        http.post("https://accounts.spotify.com/api/token", body.toString(), {
            headers: {
                Authorization: `Basic ${credentials}`,
                "Content-Type": "application/x-www-form-urlencoded",
            },
        })
    );
    return res.data;
}

async function getSpotifyToken() {
    const data = await requestToken(
        new URLSearchParams({ grant_type: "client_credentials" })
    );
    return data.access_token;
}

// OAuth authorization-code exchange (used by the export flow in server.js)
async function exchangeCodeForToken(code) {
    return requestToken(
        new URLSearchParams({
            grant_type: "authorization_code",
            code,
            redirect_uri: process.env.SPOTIFY_REDIRECT_URI,
        })
    );
}

async function searchTrack(token, title, artist) {

    const primaryArtist = artist
            .split(/\s+ft\.|\s+feat\.|\s+&|,/i)[0]
            .trim();

    try {
        const res = await http.get("https://api.spotify.com/v1/search", {
            headers: { Authorization: `Bearer ${token}` },
            params: {
                q: `track:${title} artist:${primaryArtist}`,
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
            uri: track.uri,
        };
    } catch {
        return null;
    }
}

async function getAudioFeatures(token, tracks) {
    try {
        const ids = tracks
            .filter((t) => t?.spotifyId)
            .map((t) => t.spotifyId)
            .join(",");

        if (!ids) return tracks;

        const res = await http.get("https://api.spotify.com/v1/audio-features", {
            headers: { Authorization: `Bearer ${token}` },
            params: { ids },
        });

        const featuresMap = {};
        res.data.audio_features.forEach((f) => {
            if (f) featuresMap[f.id] = f;
        });

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
    } catch (err) {
        console.error("❌ Audio features error:", err.response?.data || err.message)
        return tracks;
    }
}

module.exports = { getSpotifyToken, exchangeCodeForToken, searchTrack, getAudioFeatures, isNetworkError };