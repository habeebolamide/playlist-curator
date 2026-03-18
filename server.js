const express = require("express");
const session = require("express-session");
const crypto = require("crypto");
const axios = require("axios");
const { pendingExports } = require("./store");

const SPOTIFY_SCOPES = [
    "playlist-modify-public",
    "playlist-modify-private",
    "user-read-private",
    "user-read-email",
].join(" ");

function createServer(bot) {
    const app = express();

    app.use(session({
        secret: process.env.SESSION_SECRET || "vibelistsecret123",
        resave: false,
        saveUninitialized: true,
    }));

    app.get("/", (req, res) => {
        res.send("VibeList bot is running 🎧");
    });

    app.get("/login", (req, res) => {
        const { chatId, data } = req.query;
        if (!chatId || !data) return res.send("Missing parameters");

        const state = crypto.randomBytes(16).toString("hex");

        // Store chatId + playlist data in pendingExports keyed by state
        pendingExports[state] = {
            chatId,
            data: decodeURIComponent(data),
        };

        const params = new URLSearchParams({
            response_type: "code",
            client_id: process.env.SPOTIFY_CLIENT_ID,
            scope: SPOTIFY_SCOPES,
            redirect_uri: process.env.SPOTIFY_REDIRECT_URI,
            state,
        });

        res.redirect(`https://accounts.spotify.com/authorize?${params}&show_dialog=true`);
    });

    app.get("/callback", async (req, res) => {
        const { code, state } = req.query;
        const pending = pendingExports[state];

        if (!pending) return res.send("Session expired. Please try again from Telegram.");

        const { chatId, data } = pending;

        try {
            const export_data = JSON.parse(data);
            const { tracks, vibe, yearStart, yearEnd } = export_data;

            const credentials = Buffer.from(
                `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`
            ).toString("base64");

            const tokenRes = await axios.post(
                "https://accounts.spotify.com/api/token",
                new URLSearchParams({
                    grant_type: "authorization_code",
                    code,
                    redirect_uri: process.env.SPOTIFY_REDIRECT_URI,
                }).toString(),
                {
                    headers: {
                        Authorization: `Basic ${credentials}`,
                        "Content-Type": "application/x-www-form-urlencoded",
                    },
                }
            );

            const accessToken = tokenRes.data.access_token;

            // Get Spotify user ID
            // console.log("ACCESS TOKEN:", accessToken);
            let userRes;
            try {
                userRes = await axios.get("https://api.spotify.com/v1/me", {
                    headers: { Authorization: `Bearer ${accessToken}` },
                });
                // console.log("✅ User:",userRes.data, userRes.data.id, userRes.data.email);
            } catch (userErr) {
                console.error("❌ /me failed:", JSON.stringify(userErr.response?.data));
                throw userErr;
            }

            const userId = userRes.data.id;
            // console.log("✅ Got user ID:", userId);


            // Create playlist
            // Create playlist
            // console.log("Creating playlist for user:", userId);
            let playlistRes;
            try {
                playlistRes = await axios.post(
                    `https://api.spotify.com/v1/me/playlists`,
                    {
                        name: `VibeList — ${vibe} (${yearStart}-${yearEnd})`,
                        description: `Curated by VibeList AI 🎧`,
                        public: false,
                    },
                    { headers: { Authorization: `Bearer ${accessToken}` } }
                );
                // console.log("✅ Playlist created:", playlistRes.data.id);
            } catch (playlistErr) {
                console.error("❌ Playlist creation failed:", JSON.stringify(playlistErr.response?.data));
                console.error("❌ Playlist creation status:", playlistErr.response?.status);
                console.error("❌ Scopes on token:", tokenRes.data.scope);
                throw playlistErr;
            }

            const playlistId = playlistRes.data.id;
            const playlistUrl = playlistRes.data.external_urls.spotify;

            // Add tracks
            // Add tracks — only valid spotify URIs
            const uris = tracks
                .filter((t) => t.uri && t.uri.startsWith("spotify:track:"))
                .map((t) => t.uri);

            console.log("✅ Valid URIs to add:", uris.length);
            console.log("❌ Tracks without URI:", tracks.filter((t) => !t.uri || !t.uri.startsWith("spotify:track:")).map((t) => t.title));

            for (let i = 0; i < uris.length; i += 100) {
                const chunk = uris.slice(i, i + 100);
                try {
                    await axios.post(
                        `https://api.spotify.com/v1/playlists/${playlistId}/items`,
                        { uris: chunk },
                        { headers: { Authorization: `Bearer ${accessToken}` } }
                    );
                    console.log(`✅ Added chunk ${i / 100 + 1}`);
                } catch (trackErr) {
                    console.error("❌ Track add failed:", JSON.stringify(trackErr.response?.data));
                    console.error("❌ Problematic URIs:", chunk);
                }
            }

            // Notify on Telegram
            bot.sendMessage(
                chatId,
                `✅ Playlist exported to Spotify!\n\n🎵 ${uris.length} songs added\n\nOpen in Spotify: ${playlistUrl}`
            );

            delete pendingExports[state];

            res.send(`
                <html>
                <body style="font-family: sans-serif; text-align: center; padding: 50px; background: #121212; color: white;">
                    <h1>✅ Playlist exported!</h1>
                    <p>Your VibeList playlist has been added to Spotify.</p>
                    <p>You can close this tab and go back to Telegram.</p>
                </body>
                </html>
            `);
        } catch (err) {
            console.error("CALLBACK ERROR:", err.response?.data || err.message || err);
            res.send(`Error: ${err.response?.data?.error_description || err.message || "Unknown error"}`);
        }
    });

    return app;
}

module.exports = { createServer };