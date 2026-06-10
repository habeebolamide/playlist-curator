const crypto = require("crypto");
const { isRateLimited, incrementRateLimit, formatPlaylist, RATE_LIMIT } = require("./utils");
const { getSpotifyToken, searchTrack, getAudioFeatures, isNetworkError } = require("./spotify");
const { generatePlaylist, refinePlaylist, estimateAudioFeatures } = require("./deepseek");
const { log } = require("./logger");
const { userSessions, pendingExports } = require("./store");

const EXPORT_TTL = 2 * 60 * 60 * 1000; // export links valid for 2 hours


function initBot(bot) {
    bot.onText(/\/start/, (msg) => {
        const chatId = msg.chat.id;

        const rateCheck = isRateLimited(chatId);
        if (rateCheck.limited) {
            bot.sendMessage(
                chatId,
                `⏳ You've used your ${RATE_LIMIT} playlists for today. Come back in ${rateCheck.timeLeft}! 🎧`
            );
            delete userSessions[chatId];
            return;
        }

        userSessions[chatId] = { step: "vibe" };
        bot.sendMessage(
            chatId,
            `👋 Welcome to *VibeList* — your AI playlist curator!\n\nWhat's the vibe or genre? (e.g. Afrobeats, Road trip, Late night R&B, 90s Hip Hop)`
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

            const currentYear = new Date().getFullYear();
            if (parseInt(text) > currentYear) {
                bot.sendMessage(
                    chatId,
                    `⚠️ For best results, end year should be ${currentYear} or earlier. AI doesn't have reliable data on very recent releases and may suggest songs that don't exist yet.\n\nSend a different year or type *continue* to proceed anyway.`
                );
                session.pendingYearEnd = text;
                session.step = "yearEndWarning";
                return;
            }

            session.yearEnd = text;
            session.step = "artists";
            bot.sendMessage(
                chatId,
                `🎤 Any specific artists to include? (optional — type *skip* to skip)`
            );
            return;
        }

        if (session.step === "yearEndWarning") {
            if (text.toLowerCase() === "continue") {
                session.yearEnd = session.pendingYearEnd;
            } else if (!isNaN(text) && text.length === 4) {
                session.yearEnd = text;
            } else {
                bot.sendMessage(chatId, `Please enter a valid year or type *continue* to proceed anyway.`);
                return;
            }
            session.step = "artists";
            bot.sendMessage(
                chatId,
                `🎤 Any specific artists to include? (optional — type *skip* to skip)`
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
            if (isNaN(length) || length < 1 || length > 30) {
                bot.sendMessage(chatId, `Please enter a number between 1 and 30`);
                return;
            }

            session.length = length;
            session.step = "done";

            bot.sendMessage(chatId, `⏳ Curating your playlist, hang tight...`);

            try {
                const suggestions = await generatePlaylist(
                    session.vibe,
                    session.yearStart,
                    session.yearEnd,
                    session.artists,
                    session.length
                );

                const token = await getSpotifyToken();
                const enriched = await Promise.all(
                    suggestions.map((t) => searchTrack(token, t.title, t.artist))
                );

                const withFallback = enriched.map((spotifyTrack, i) =>
                    spotifyTrack || {
                        ...suggestions[i],
                        album: "Unknown Album",
                        year: suggestions[i].year || "N/A",
                    }
                );

                // bot.sendMessage(chatId, `🎚 Analyzing audio features...`);
                const withFeatures = await estimateAudioFeatures(withFallback);

                log("ESTIMATED_AUDIO_FEATURES", { withFeatures });


                await bot.sendMessage(chatId, `🎛 Optimizing flow and transitions...`);
                const { tracks: refined, swapCount } = await refinePlaylist(
                    withFeatures,
                    session.vibe,
                    token
                );

                const withURI = refined.filter(t => t.uri).length;
                const withoutURI = refined.filter(t => !t.uri).map(t => t.title);
                console.log(`📊 After refinement — with URI: ${withURI}/${refined.length}`);
                console.log(`📊 Missing URI:`, withoutURI);

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

                await bot.sendMessage(chatId, message);

                // Store the playlist server-side and put only a short id in the URL,
                // so Telegram's link-confirmation popup stays small
                for (const [id, entry] of Object.entries(pendingExports)) {
                    if (Date.now() - (entry.createdAt || 0) > EXPORT_TTL) delete pendingExports[id];
                }

                const exportId = crypto.randomBytes(16).toString("hex");
                pendingExports[exportId] = {
                    chatId,
                    tracks: refined,
                    vibe: session.vibe,
                    yearStart: session.yearStart,
                    yearEnd: session.yearEnd,
                    createdAt: Date.now(),
                };

                await bot.sendMessage(chatId, `Want to save this to Spotify?`, {
                    reply_markup: {
                        inline_keyboard: [
                            [
                                {
                                    text: "🎵 Export to Spotify",
                                    url: `${process.env.BASE_URL}/login?eid=${exportId}`,
                                },
                            ],
                        ],
                    },
                });

                incrementRateLimit(chatId);

                bot.sendMessage(chatId, `🔁 Type /start to generate another playlist`);
            } catch (err) {
                if (isNetworkError(err)) {
                    console.error(`❌ Playlist generation failed: network error (${err.code})`);
                } else {
                    console.error(err);
                }
                bot.sendMessage(
                    chatId,
                    isNetworkError(err)
                        ? `📡 Network hiccup — couldn't reach the music services. Try /start again in a moment.`
                        : `Something went wrong generating your playlist. Try /start again.`
                );
            }

            delete userSessions[chatId];
            return;
        }
    });
}

module.exports = { initBot };