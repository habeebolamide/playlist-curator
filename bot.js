const { isRateLimited, formatPlaylist, RATE_LIMIT } = require("./utils");
const { getSpotifyToken, searchTrack, getAudioFeatures } = require("./spotify");
const { generatePlaylist, refinePlaylist } = require("./gemini");
const { log } = require("./logger");
const { userSessions } = require("./store");''


function initBot(bot) {
    bot.onText(/\/start/, (msg) => {
        const chatId = msg.chat.id;

        const rateCheck = isRateLimited(chatId);
        if (rateCheck.limited) {
            bot.sendMessage(
                chatId,
                `⏳ You've hit the limit of ${RATE_LIMIT} playlists per hour. Try again in ${rateCheck.minutesLeft} minute${rateCheck.minutesLeft > 1 ? "s" : ""}!`
            );
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
            if (parseInt(text) > currentYear - 1) {
                bot.sendMessage(
                    chatId,
                    `⚠️ For best results, end year should be ${currentYear - 1} or earlier. AI doesn't have reliable data on very recent releases and may suggest songs that don't exist yet.\n\nSend a different year or type *continue* to proceed anyway.`
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
                        year: "N/A",
                    }
                );

                log("TRACK", { track: withFallback });


                // bot.sendMessage(chatId, `🎚 Analyzing audio features...`);
                // const withFeatures = await getAudioFeatures(token, withFallback);

                bot.sendMessage(chatId, `🎛 Optimizing flow and transitions...`);
                const { tracks: refined, swapCount } = await refinePlaylist(
                    withFallback,
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

                const exportData = encodeURIComponent(JSON.stringify({
                    tracks: refined,
                    vibe: session.vibe,
                    yearStart: session.yearStart,
                    yearEnd: session.yearEnd,
                }));

                await bot.sendMessage(chatId, `Want to save this to Spotify?`, {
                    reply_markup: {
                        inline_keyboard: [
                            [
                                {
                                    text: "🎵 Export to Spotify",
                                    url: `${process.env.BASE_URL}/login?chatId=${chatId}&data=${exportData}`,
                                },
                            ],
                        ],
                    },
                });

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
}

module.exports = { initBot };