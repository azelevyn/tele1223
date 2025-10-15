import { Telegraf, Markup, session } from "telegraf";
import dotenv from "dotenv";
dotenv.config();

const bot = new Telegraf(process.env.BOT_TOKEN);
bot.use(session());

const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
const RATE = 0.98; // 250 Stars = 0.98 USDT
const AMOUNTS = [250, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000];

// === Helper functions ===
const isValidUSDT = (addr) => /^0x[a-fA-F0-9]{40}$/.test(addr);
const isValidTON = (addr) => /^(EQ|kQ)[A-Za-z0-9_-]{48}$/.test(addr);

const calcUSDT = (stars) => ((stars / 250) * RATE).toFixed(2);

// === Start Command ===
bot.start((ctx) => {
  ctx.session = {};
  ctx.reply(
    `🌟 Welcome ${ctx.from.first_name}!\n\n` +
      `You can convert your Telegram Stars into USDT or TON.\n\n` +
      `💰 Rate: 250 Stars = 0.98 USDT\n` +
      `📉 Minimum: 250 Stars\n📈 Maximum: 100,000 Stars\n\nChoose how much you want to sell:`,
    Markup.inlineKeyboard(
      AMOUNTS.map((amt) => [
        Markup.button.callback(`${amt} ⭐ = ${calcUSDT(amt)} USDT`, `SELL_${amt}`)
      ])
    )
  );
});

// === Amount Selection ===
bot.action(/SELL_(\d+)/, async (ctx) => {
  const stars = Number(ctx.match[1]);
  ctx.session.stars = stars;
  ctx.session.amountUSD = calcUSDT(stars);
  await ctx.answerCbQuery();

  await ctx.reply(
    `You selected *${stars} Stars* (~${ctx.session.amountUSD} USDT)\n\nChoose how you want to receive your payment:`,
    {
      parse_mode: "Markdown",
      ...Markup.inlineKeyboard([
        [Markup.button.callback("💵 Receive in USDT (BEP20)", "PAY_USDT")],
        [Markup.button.callback("💎 Receive in TON", "PAY_TON")]
      ])
    }
  );
});

// === User chooses USDT ===
bot.action("PAY_USDT", async (ctx) => {
  ctx.session.method = "USDT";
  await ctx.answerCbQuery();
  await ctx.reply("Please enter your *USDT BEP20 wallet address:*", { parse_mode: "Markdown" });
  ctx.session.awaitingAddress = true;
});

// === User chooses TON ===
bot.action("PAY_TON", async (ctx) => {
  ctx.session.method = "TON";
  await ctx.answerCbQuery();
  await ctx.reply("Please enter your *TON wallet address:*", { parse_mode: "Markdown" });
  ctx.session.awaitingAddress = true;
});

// === Address Validation ===
bot.on("text", async (ctx) => {
  if (ctx.session.awaitingAddress) {
    const addr = ctx.message.text.trim();
    const method = ctx.session.method;

    if (method === "USDT" && !isValidUSDT(addr))
      return ctx.reply("⚠️ Please provide a valid USDT BEP20 address (starts with 0x...)");

    if (method === "TON" && !isValidTON(addr))
      return ctx.reply("⚠️ Please provide a valid TON address.");

    ctx.session.address = addr;
    ctx.session.awaitingAddress = false;

    await ctx.reply(
      `✅ Perfect!\n\n` +
        `You are selling *${ctx.session.stars} Stars* (~${ctx.session.amountUSD} USDT)\n` +
        `You will receive in *${method}*:\n\`${addr}\`\n\n` +
        `⏳ Your withdrawal is being processed.\nEstimated time: *5 minutes to 1 hour*.`,
      { parse_mode: "Markdown" }
    );

    // Notify admin
    await bot.telegram.sendMessage(
      `@${ADMIN_USERNAME}`,
      `📩 *New Conversion Request*\n\n👤 User: @${ctx.from.username || ctx.from.first_name}\n⭐ Stars: ${ctx.session.stars}\n💰 Amount: ${ctx.session.amountUSD} USDT\n💱 Method: ${method}\n🏦 Address: ${addr}`,
      { parse_mode: "Markdown" }
    );
  }
});

bot.launch();
console.log("🚀 Bot is running successfully...");
