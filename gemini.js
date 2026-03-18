const { GoogleGenerativeAI } = require("@google/generative-ai");
const { searchTrack } = require("./spotify");
const { log } = require("./logger");


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
    const parsed = JSON.parse(clean);
    log("GENERATE_PLAYLIST_PARSED", { count: parsed.length, tracks: parsed });

    return parsed;
}


async function estimateAudioFeatures(tracks) {
    const trackList = tracks
        .map((t, i) => `${i + 1}. "${t.title}" by ${t.artist}`)
        .join("\n");

    const prompt = `You are a music data expert with deep knowledge of music theory and production.

For each of the following songs, estimate their audio features based on your knowledge.
Be as accurate as possible — use your knowledge of the song's production, tempo, mood and energy.

Songs:
${trackList}

Return ONLY a JSON array in this exact format, no explanation, no markdown:
[
  {
    "title": "Song Title",
    "artist": "Artist Name",
    "bpm": 98,
    "key": "A Minor",
    "energy": 0.75,
    "danceability": 0.82,
    "valence": 0.65
  }
]

Guidelines:
- BPM: realistic tempo (60-180)
- Key: format as "Note Major/Minor" e.g. "F# Minor"
- Energy: 0-1 (0 = very calm, 1 = very intense)
- Danceability: 0-1 (0 = not danceable, 1 = very danceable)
- Valence: 0-1 (0 = dark/sad, 1 = happy/euphoric)`;

    try {
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
        const result = await model.generateContent(prompt);
        const raw = result.response.text().trim();
        const clean = raw.replace(/```json|```/g, "").trim();
        const estimated = JSON.parse(clean);


        // Merge estimated features back into original tracks
        return tracks.map((track) => {
            const estimate = estimated.find(
                (e) => e.title.toLowerCase() === track.title.toLowerCase()
            );
            if (!estimate) return track;
            return {
                ...track,
                bpm: estimate.bpm,
                key: estimate.key,
                energy: estimate.energy,
                danceability: estimate.danceability,
                valence: estimate.valence,
                featuresSource: "estimated",
            };
        });
    } catch (err) {
        console.error("❌ Feature estimation error:", err.message);
        return tracks;
    }
}

async function refinePlaylist(tracks, vibe, token) {
    // const tracksWithFeatures = tracks.filter((t) => t?.bpm);
    // if (tracksWithFeatures.length < 3) return { tracks, swapCount: 0 };

    if (tracks.length < 3) return { tracks, swapCount: 0 };

    // const trackData = tracks
    //     .map((t, i) =>
    //         `${i + 1}. "${t.title}" by ${t.artist} | BPM: ${t.bpm || "unknown"} | Key: ${t.key || "unknown"} | Energy: ${t.energy ? t.energy.toFixed(2) : "unknown"} | Danceability: ${t.danceability ? t.danceability.toFixed(2) : "unknown"} | Mood: ${t.valence ? t.valence.toFixed(2) : "unknown"}`
    //     )
    //     .join("\n");

    const trackData = tracks
        .map((t, i) =>
            `${i + 1}. "${t.title}" by ${t.artist} (${t.year || "unknown year"})`
        )
        .join("\n");
        const prompt = `You are a world class DJ with 20 years of experience curating seamless playlists.

Here are the songs with their audio features:
${trackData}

Your job is to reorder these songs so the playlist flows like a professional DJ set.

STRICT RULES — you must follow these exactly:
1. BPM transitions: never jump more than 15 BPM between consecutive songs
2. Energy arc: the playlist must tell a story — choose ONE of these shapes:
   - JOURNEY: start medium → build to peak → come back down softly
   - WAVE: build → peak → brief dip → build again → final peak
   - ASCENT: start low → steady climb → end at peak
3. Never place two high energy songs (energy > 0.85) back to back unless BPM and key match perfectly
4. Never drop energy by more than 0.2 in a single step
5. Key transitions: prefer same key or relative major/minor between consecutive songs
6. The first song sets the mood — pick something that eases the listener in
7. The last song should feel like a satisfying ending — not an abrupt stop

For each song that is a clear vibe break and cannot be placed anywhere without disrupting flow, suggest a replacement that fits the ${vibe} genre and matches the energy needed at that position.

Return ONLY a JSON object, no explanation, no markdown:
{
  "playlist": [
    {"title": "Song Name", "artist": "Artist Name"},
    {"title": "Song Name", "artist": "Artist Name"}
  ],
  "swaps": [
    {"removed": "Song that was replaced", "added": "Song that replaced it", "reason": "brief reason"}
  ]
}

If no swaps were needed, return an empty swaps array.`;

    try {
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
        const result = await model.generateContent(prompt);
        const raw = result.response.text().trim();
        const clean = raw.replace(/```json|```/g, "").trim();
        const refined = JSON.parse(clean);

        // console.log("🔍 Refinement result:", JSON.stringify(refined, null, 2));

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
        log("REFINE_FINAL_TRACKS", {
            total: finalTracks.length,
            withURI: finalTracks.filter(t => t.uri).length,
            withoutURI: finalTracks.filter(t => !t.uri).map(t => ({ title: t.title, artist: t.artist })),
            tracks: finalTracks.map(t => ({ title: t.title, artist: t.artist, uri: t.uri || null })),
        });
        return { tracks: finalTracks, swapCount: swaps.length };
    } catch {
        return { tracks, swapCount: 0 };
    }
}

module.exports = { generatePlaylist, refinePlaylist, estimateAudioFeatures };