require("dotenv").config();
const axios = require("axios");

async function test() {
    try {
        const credentials = Buffer.from(
            `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`
        ).toString("base64");

        console.log("CLIENT ID:", process.env.SPOTIFY_CLIENT_ID);
        console.log("REDIRECT URI:", process.env.SPOTIFY_REDIRECT_URI);

        // Test client credentials flow
        const tokenRes = await axios.post(
            "https://accounts.spotify.com/api/token",
            "grant_type=client_credentials",
            {
                headers: {
                    Authorization: `Basic ${credentials}`,
                    "Content-Type": "application/x-www-form-urlencoded",
                },
            }
        );
        console.log("✅ Client credentials token works");

        // Test search
        const searchRes = await axios.get("https://api.spotify.com/v1/search", {
            headers: { Authorization: `Bearer ${tokenRes.data.access_token}` },
            params: { q: "Wizkid", type: "track", limit: 1 },
        });
        console.log("✅ Search works:", searchRes.data.tracks.items[0].name);

    } catch (err) {
        console.error("❌ ERROR:", err.response?.data || err.message);
    }
}

test();