const { GoogleGenerativeAI } = require("@google/generative-ai");
const { searchTrack } = require("./spotify");

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

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
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
        const result = await model.generateContent(prompt);
        const raw = result.response.text().trim();
        const clean = raw.replace(/```json|```/g, "").trim();
        const refined = JSON.parse(clean);

        console.log("🔍 Refinement result:", JSON.stringify(refined, null, 2));

        const reordered = refined.playlist;
        const swaps = refined.swaps || [];

        const finalTracks = await Promise.all(
            reordered.map(async (r) => {
                // Try exact title match first
                let existing = tracks.find(
                    (t) => t.title.toLowerCase() === r.title.toLowerCase()
                );

                // Try partial match if exact fails
                if (!existing) {
                    existing = tracks.find(
                        (t) =>
                            t.title.toLowerCase().includes(r.title.toLowerCase()) ||
                            r.title.toLowerCase().includes(t.title.toLowerCase())
                    );
                }

                if (existing) return existing;

                // It's a new replacement — fetch from Spotify to get URI
                const newTrack = await searchTrack(token, r.title, r.artist);
                return newTrack || { ...r, album: "Unknown Album", year: "N/A" };
            })
        );

        // Log URI coverage
        const withUri = finalTracks.filter(t => t.uri).length;
        console.log(`✅ Tracks with URI: ${withUri}/${finalTracks.length}`);

        return { tracks: finalTracks, swapCount: swaps.length };
    } catch {
        return { tracks, swapCount: 0 };
    }
}

module.exports = { generatePlaylist, refinePlaylist };