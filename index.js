import { Telegraf, Markup, session } from "telegraf";
import dotenv from "dotenv";
dotenv.config();

const bot = new Telegraf(process.env.BOT_TOKEN);
bot.use(session());

// Admin username from .env
const ADMIN_USERNAME = process.env.ADMIN_USERNAME;

// Conversion settings
const RATE = 0.98; // 250 Stars = 0.98 USDT
const AMOUNTS = [250, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000];
const isValidUSDT = (addr) => /^0x[a-fA-F0-9]{40}$/.test(addr);
const calcUSDT = (stars) => ((stars / 250) * RATE).toFixed(2);

// Helper: ensure session object exists
function ensureSession(ctx) {
  if (!ctx.session) ctx.session = {};
  return ctx.session;
}

// === Start ===
bot.start((ctx) => {
  ensureSession(ctx);
  ctx.reply(
    `🌟 Welcome ${ctx.from.first_name}!\n\n` +
      `You can convert your Telegram Stars balance into USDT (BEP20).\n\n` +
      `💰 Rate: 250 Stars = 0.98 USDT\n` +
      `📉 Minimum: 250 Stars\n📈 Maximum: 100,000 Stars\n\nChoose how much you want to sell:`,
    Markup.inlineKeyboard(
      AMOUNTS.map((amt) => [
        Markup.button.callback(`${amt} ⭐ = ${calcUSDT(amt)} USDT`, `SELL_${amt}`)
      ])
    )
  );
});

// === Amount selection ===
bot.action(/SELL_(\d+)/, async (ctx) => {
  const stars = Number(ctx.match[1]);
  const session = ensureSession(ctx);
  session.stars = stars;
  session.amountUSD = calcUSDT(stars);

  await ctx.answerCbQuery();
  await ctx.reply(
    `You selected *${stars} Stars* (~${session.amountUSD} USDT)\n\n` +
      `Please provide your *USDT BEP20 wallet address* to receive the payment.`,
    { parse_mode: "Markdown" }
  );

  session.awaitingAddress = true;
});

// === Handle USDT address ===
bot.on("text", async (ctx) => {
  const session = ensureSession(ctx);
  if (session.awaitingAddress) {
    const addr = ctx.message.text.trim();

    if (!isValidUSDT(addr))
      return ctx.reply("⚠️ Please provide a valid USDT BEP20 address (starts with 0x...)");

    session.address = addr;
    session.awaitingAddress = false;

    await ctx.reply(
      `✅ Perfect!\n\n` +
        `You are selling *${session.stars} Stars* (~${session.amountUSD} USDT)\n` +
        `You will receive to:\n\`${addr}\`\n\n` +
        `Click the button below to make payment using your Telegram Stars balance.`,
      {
        parse_mode: "Markdown",
        ...Markup.inlineKeyboard([
          [Markup.button.callback("⭐ PAY WITH STARS", "PAY_WITH_STARS")]
        ])
      }
    );
  }
});

// === Handle payment button ===
bot.action("PAY_WITH_STARS", async (ctx) => {
  const session = ensureSession(ctx);

  if (!session.stars || !session.address) {
    await ctx.answerCbQuery();
    return ctx.reply("⚠️ Please start again with /start to select your amount first.");
  }

  await ctx.answerCbQuery();

  await ctx.reply(
    `💫 To complete the transaction:\n\n` +
      `1️⃣ Pay *${session.stars} Stars* using your Telegram Stars balance.\n` +
      `2️⃣ Once paid, please wait for confirmation.\n\n` +
      `⏳ Your withdrawal is being processed.\nEstimated time: *5 minutes to 1 hour*.\n\n` +
      `Thank you for your patience!`,
    { parse_mode: "Markdown" }
  );

  // Notify admin
  await bot.telegram.sendMessage(
    `@${ADMIN_USERNAME}`,
    `📩 *New Sell Request*\n\n` +
      `👤 User: @${ctx.from.username || ctx.from.first_name}\n` +
      `⭐ Stars: ${session.stars}\n💰 Amount: ${session.amountUSD} USDT\n` +
      `🏦 Address: ${session.address}\n📤 Status: Awaiting Stars Payment`,
    { parse_mode: "Markdown" }
  );

  // Clear session after notification
  ctx.session = {};
});

bot.launch();
console.log("🚀 Bot is running successfully...");
