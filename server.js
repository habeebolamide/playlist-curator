const express = require("express");
const session = require("express-session");
const crypto = require("crypto");
const axios = require("axios");

const SPOTIFY_SCOPES = [
    "playlist-modify-public",
    "playlist-modify-private",
].join(" ");

const { spotifyTokens, pendingExports } = require("./store");

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
        const { chatId } = req.query;
        if (!chatId) return res.send("Missing chatId");

        const state = crypto.randomBytes(16).toString("hex");
        pendingExports[state] = chatId;

        const params = new URLSearchParams({
            response_type: "code",
            client_id: process.env.SPOTIFY_CLIENT_ID,
            scope: SPOTIFY_SCOPES,
            redirect_uri: process.env.SPOTIFY_REDIRECT_URI,
            state,
        });

        res.redirect(`https://accounts.spotify.com/authorize?${params}`);
    });

    app.get("/callback", async (req, res) => {
        const { code, state } = req.query;
        const chatId = pendingExports[state];

        if (!chatId) return res.send("Session expired. Please try again from Telegram.");

        try {
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

            console.log("TOKEN RES:", tokenRes.data);
            console.log("REDIRECT URI USED:", process.env.SPOTIFY_REDIRECT_URI);

            const accessToken = tokenRes.data.access_token;
            const export_data = spotifyTokens[chatId];

            if (!export_data) {
                return res.send("Playlist data expired. Please generate a new playlist.");
            }

            const { tracks, vibe, yearStart, yearEnd } = export_data;

            const userRes = await axios.get("https://api.spotify.com/v1/me", {
                headers: { Authorization: `Bearer ${accessToken}` },
            });
            const userId = userRes.data.id;

            const playlistRes = await axios.post(
                `https://api.spotify.com/v1/users/${userId}/playlists`,
                {
                    name: `VibeList — ${vibe} (${yearStart}-${yearEnd})`,
                    description: `Curated by VibeList AI 🎧`,
                    public: false,
                },
                { headers: { Authorization: `Bearer ${accessToken}` } }
            );

            const playlistId = playlistRes.data.id;
            const playlistUrl = playlistRes.data.external_urls.spotify;

            const uris = tracks.filter((t) => t.uri).map((t) => t.uri);

            for (let i = 0; i < uris.length; i += 100) {
                const chunk = uris.slice(i, i + 100);
                await axios.post(
                    `https://api.spotify.com/v1/playlists/${playlistId}/tracks`,
                    { uris: chunk },
                    { headers: { Authorization: `Bearer ${accessToken}` } }
                );
            }

            bot.sendMessage(
                chatId,
                `✅ Playlist exported to Spotify!\n\n🎵 ${uris.length} songs added\n\nOpen in Spotify: ${playlistUrl}`
            );

            delete pendingExports[state];
            delete spotifyTokens[chatId];

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

module.exports = { createServer, spotifyTokens };