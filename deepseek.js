const { createHttpClient } = require("./http");
const { searchTrack } = require("./spotify");
const { log } = require("./logger");

// LLM calls are slow — generous timeout, credential-redacted errors
const http = createHttpClient(120000);

async function callDeepSeek(prompt, jsonMode = false, system = null) {
    if (!process.env.DEEPSEEK_API_KEY || process.env.DEEPSEEK_API_KEY === "your_deepseek_api_key_here") {
        throw new Error("DEEPSEEK_API_KEY is not configured in environment variables.");
    }

    const messages = [];
    if (system) messages.push({ role: "system", content: system });
    messages.push({ role: "user", content: prompt });

    const payload = {
        model: "deepseek-v4-flash",
        messages
    };

    if (jsonMode) {
        payload.response_format = { type: "json_object" };
    }

    const response = await http.post(
        "https://api.deepseek.com/chat/completions",
        payload,
        {
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${process.env.DEEPSEEK_API_KEY}`
            }
        }
    );

    return response.data.choices[0].message.content.trim();
}

async function generatePlaylist(vibe, yearStart, yearEnd, artists, length) {
    const system = `You are VibeList's head curator — a world-class DJ and music encyclopedist.

African music is your home turf: Afrobeats, Afropop, Amapiano, Highlife, Alté, Gqom and Afro-fusion across the Nigerian, Ghanaian and South African scenes — from Fela Kuti, 2Baba, P-Square and D'banj through Wizkid, Davido, Burna Boy, Olamide, Tiwa Savage and Adekunle Gold to Rema, Asake, Tems, Ayra Starr, Fireboy DML, Seyi Vibez and Shallipopi. You bring the same depth to Hip Hop, R&B, Dancehall, Reggae, Soul and Pop.

You know the difference between a song that merely charted and a song that moves a room. You curate for the room.`;

    const artistLine = artists
        ? `- Requested artists: ${artists}. Feature them where they genuinely fit, but never force a track that breaks the vibe.`
        : `- Artists: curator's choice — whoever serves the vibe best.`;

    const prompt = `Curate a playlist of exactly ${length} songs.

THE BRIEF
- Vibe: ${vibe}
- Era: ${yearStart}–${yearEnd} (original release year — strict)
${artistLine}

SELECTION RULES — in priority order:
1. Real songs only. Every track must be an officially released song you are certain exists. Never invent a title. If you're not sure a song exists, swap in one you're certain of.
2. Exact metadata. "title" must be the official track title exactly as it appears on Spotify — no annotations, no "(feat. ...)" unless it's part of the official title. "artist" must be the primary credited artist only.
3. Vibe first. Judge each song by how it actually sounds — tempo, mood, energy — not by the artist's fame. A superstar's off-vibe song is the wrong pick; a perfectly on-vibe cut from a respected artist is a great pick.
4. Era discipline. The original release year must fall within ${yearStart}–${yearEnd}. If you can't confidently place a song's release year in range, replace it.
5. Zero filler. Every track must be a certified hit or a beloved standout — the kind that makes people say "omo, this playlist is fire". No album filler, no obscure B-sides.
6. Range. At most 2 songs per artist (3 for requested artists). Spread picks across the era instead of clustering in one year. Blend mega-hits with a few quality picks real fans love.

SEQUENCING — order the list like a DJ set:
- Track 1 instantly sets the mood and hooks the listener.
- Build energy in waves — keep BPM and groove compatible between neighbours, no jarring jumps or clashing rhythms.
- Place the biggest peak around two-thirds of the way in.
- The final track is a satisfying closer that resolves the journey.

FINAL CHECK — before answering, re-scan your list and replace any song that (a) might not exist, (b) falls outside ${yearStart}–${yearEnd}, or (c) doesn't truly match the "${vibe}" vibe.

Return ONLY raw JSON, no explanation, no markdown, in exactly this shape:
{
  "songs": [
    {"title": "Song Name", "artist": "Primary Artist", "year": 2015}
  ]
}`;

    const content = await callDeepSeek(prompt, true, system);
    const parsed = JSON.parse(content);
    const songs = parsed.songs || [];
    log("GENERATE_PLAYLIST_PARSED", { count: songs.length, tracks: songs });

    return songs;
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

Return ONLY a JSON object in this exact format, no explanation, no markdown:
{
  "features": [
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
}

Guidelines:
- BPM: realistic tempo (60-180)
- Key: format as "Note Major/Minor" e.g. "F# Minor"
- Energy: 0-1 (0 = very calm, 1 = very intense)
- Danceability: 0-1 (0 = not danceable, 1 = very danceable)
- Valence: 0-1 (0 = dark/sad, 1 = happy/euphoric)`;

    try {
        const content = await callDeepSeek(prompt, true);
        const parsed = JSON.parse(content);
        const estimated = parsed.features || [];

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
    if (tracks.length < 3) return { tracks, swapCount: 0 };

    const trackData = tracks
        .map((t, i) =>
            `${i + 1}. "${t.title}" by ${t.artist} (${t.year || "unknown year"})`
        )
        .join("\n");

    const prompt = `You are a world-class DJ with 20 years of experience curating seamless, high-vibe playlists.

Here are the songs with their audio features:
${trackData}

Your job is to reorder these songs so the playlist flows like an elite professional DJ set. 

STRICT RULES — you must follow these exactly to ensure the mix is seamless and absolutely fire:
1. BPM and Rhythmic Transition:
   - NEVER jump more than 12 BPM between consecutive songs.
   - Transitions must feel completely organic and natural—ensure there is ABSOLUTELY NO "off-beat" or jarring transition in groove, rhythm, or timing from one song to the next.
2. Key and Harmonic compatibility:
   - Prefer mixing in key (same key or relative major/minor) between consecutive songs to keep the melodic blend smooth.
3. Vibe and Energy Progression ("Omo, this playlist is fire!"):
   - Structure the momentum so that every next track feels like a perfect, satisfying, and exciting progression from the previous one.
   - Energy arc: Select one of these shapes that best fits the vibe:
     - JOURNEY: start medium → build to peak → come back down softly
     - WAVE: build → peak → brief dip → build again → final peak
     - ASCENT: start low → steady climb → end at peak
   - Never drop energy by more than 0.15 in a single step unless it's an intentional transition.
   - Never place two high-energy songs (energy > 0.85) back-to-back unless the BPM and key are a perfect match.
4. Set Structure:
   - The first song must capture attention and ease the listener into the groove.
   - The last song must feel like a satisfying, epic ending.

For any song in the list that is a vibe-killer, tempo anomaly, or breaks the flow of the set, you MUST swap it. Suggest a replacement song from the "${vibe}" genre that fits the energy and keeps the momentum burning.

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
        const content = await callDeepSeek(prompt, true);
        const refined = JSON.parse(content);

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
    } catch (err) {
        console.error("❌ Playlist refinement error:", err.message);
        return { tracks, swapCount: 0 };
    }
}

module.exports = { generatePlaylist, refinePlaylist, estimateAudioFeatures };
