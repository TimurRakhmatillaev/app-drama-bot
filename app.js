const fs = require("fs");
const path = require("path");
const Telegraf = require("telegraf");
const Extra = require("telegraf/extra");
const Markup = require("telegraf/markup");
const LocalSession = require("telegraf-session-local");
const xlsx = require("node-xlsx");

let languages = ["English"];

let projectJson = fs.readFileSync(path.join(__dirname, "Drama", "butler.mdbpj"));
let project = JSON.parse(projectJson);

let projects = [project];

let chapters = project["chapters"]
    .map(x => fs.readFileSync(path.join(__dirname, "Drama", "Res", "scripts", `${x["name"]}.cmds`)))
    .map(x => JSON.parse(x));

let languageTable = xlsx.parse(path.join(__dirname, "Drama", "Res", "butler.langTable1217.xlsx"))
    .filter(x => x.name.startsWith("chp"))
    .map(x => x.data.filter((_, i) => i >= 2))
    .reduce((acc, rows) => {
        rows.forEach(row => acc.push(row));
        return acc;
    }, [])
    .reduce((acc, [key, speaker, text]) => {
        acc[key] = {speaker, text};
        return acc;
    }, {});

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
const localSession = new LocalSession({database: "sessions.json"});

bot.use(localSession.middleware());

bot.start(async ctx => {
    ctx.session["state"] = "language";

    const keyboard = Markup
        .keyboard(languages.map(x => [x]))
        .oneTime()
        .resize();
    await ctx.reply("Select language", keyboard.extra());
});

const getProperty = (command, propertyName) => {
    return command["properties"].find(x => x["name"] === propertyName)["value"];
};

const setBackground = async (ctx, background) => {
    const bgIndex = project["treeFolders"]
        .find(x => x["name"] === "bg")["children"]
        .map((id, index) => ({id, index}))
        .find(({id, index}) => id === background).index;
    const fileName = fs.readdirSync(path.join(__dirname, "Drama", "Res", "bg"))
        .find((_, i) => i === bgIndex);
    const filePath = path.join(__dirname, "Drama", "Res", "bg", fileName);

    if (ctx.session["backgroundMessage"]) {
        const messageId = ctx.session["backgroundMessage"];

        await bot.telegram.editMessageMedia(ctx.chat.id, messageId, null, {
            "media": { source: fs.createReadStream(filePath) },
            "type": "photo"
        })
    }
    else {
        const [message] = await ctx.replyWithMediaGroup([ {
            "media": { source: fs.createReadStream(filePath) },
            "type": "photo"
        }]);
        ctx.session["backgroundMessage"] = message["message_id"];
    }
};

const setText = async (ctx, textId) => {
    const {speaker, text} = languageTable[textId];
    const messageText = speaker ? `<b>${speaker}</b>\n${text}` : text;

    if (ctx.session["textMessage"]) {
        const messageId = ctx.session["textMessage"];
        const inlineKeyboard = Markup.inlineKeyboard([[Markup.callbackButton("Next", "next")]]);

        await bot.telegram.editMessageText(ctx.chat.id, messageId, null, messageText, {
            parse_mode: "HTML",
            ...inlineKeyboard.extra()
        });
    }
    else {
        const inlineKeyboard = Markup.inlineKeyboard([[Markup.callbackButton("Next", "next")]]);
        const message = await ctx.replyWithHTML(messageText, inlineKeyboard.extra());

        ctx.session["textMessage"] = message["message_id"];
    }
};

const doGame = async ctx => {
    const {chapter: chapterName, commandCursor} = ctx.session;
    const chapterIndex = project["chapters"]
        .map(({name}, index) => ({name, index}))
        .filter(x => x.name === chapterName)
        .map(x => x.index)[0];
    const {commands} = chapters[chapterIndex];

    for (let i = commandCursor; i < commands.length; i++) {
        const command = commands[i];
        switch (command["name"]) {
            case "cmdShowBackground": {
                await setBackground(ctx, getProperty(command, "bgName")["entityID"]);
                break;
            }
            case "cmdText": {
                await setText(ctx, getProperty(command, "text"));
                ctx.session["commandCursor"] = i + 1;
                return;
            }
            case "cmdChoicesStart": {
                break;
            }
        }
    }
};

bot.on("text", async ctx => {
    const {text} = ctx.update.message;
    switch (ctx.session["state"]) {
        case "language": {
            if (languages.indexOf(text) === -1) {
                await ctx.reply("Can't understand");
                return;
            }

            ctx.session["language"] = text;
            ctx.session["state"] = "game";

            const keyboard = Markup
                .keyboard(projects.map(x => [x["title"]]))
                .oneTime()
                .resize();
            await ctx.reply("Select game", keyboard.extra());
            break;
        }
        case "game": {
            if (!projects.some(x => x["title"] === text)) {
                await ctx.reply("Can't understand");
                return;
            }

            ctx.session["game"] = text;
            ctx.session["state"] = "chapter";

            const keyboard = Markup
                .keyboard(project["chapters"].map(x => [x["name"]]))
                .oneTime()
                .resize();
            await ctx.reply("Select chapter", keyboard.extra());
            break;
        }
        case "chapter": {
            // if (!chapters.some(x => x["title"] === text)) {
            //     await ctx.reply("Can"t understand");
            //     return;
            // }

            ctx.session["chapter"] = text;
            ctx.session["commandCursor"] = 0;
            ctx.session["state"] = "playing";

            await doGame(ctx);
            break;
        }
        default: {
            break;
        }
    }
});

bot.action("next", async ctx => {
    if (ctx.session["state"] === "playing") {
        await doGame(ctx);
    }
});

bot.launch();
