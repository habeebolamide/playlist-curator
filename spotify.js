const axios = require("axios");

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

        const res = await axios.get("https://api.spotify.com/v1/audio-features", {
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
    } catch {
        return tracks;
    }
}

module.exports = { getSpotifyToken, searchTrack, getAudioFeatures };