import { Telegraf, Markup } from 'telegraf';
import dotenv from 'dotenv';
dotenv.config();

const bot = new Telegraf(process.env.BOT_TOKEN);
const ADMIN_USERNAME = process.env.ADMIN_USERNAME;

// Conversion settings
const MIN_STARS = 250;
const MAX_STARS = 50000;
const RATE_USDT = 0.98; // per 250 stars = 0.98 USDT

// Start command
bot.start((ctx) => {
  ctx.reply(
    `🌟 Welcome ${ctx.from.first_name}!\n\n` +
    `You can convert your Telegram Stars balance into USDT or TON.\n\n` +
    `💰 Rate: 250 Stars = 0.98 USDT\n` +
    `📉 Minimum: 250 Stars\n📈 Maximum: 50,000 Stars\n\n` +
    `Click "Sell Stars" to begin.`,
    Markup.inlineKeyboard([
      [Markup.button.callback("💸 Sell Stars", "SELL_STARS")]
    ])
  );
});

// Sell stars flow
bot.action("SELL_STARS", (ctx) => {
  ctx.reply("Enter the amount of Stars you want to sell (between 250 and 50000):");
  ctx.session = { ...ctx.session, awaitingAmount: true };
});

bot.on("text", async (ctx) => {
  const text = ctx.message.text;
  const amount = parseFloat(text);

  if (ctx.session?.awaitingAmount) {
    if (isNaN(amount)) return ctx.reply("❌ Please enter a valid number.");
    if (amount < MIN_STARS) return ctx.reply(`⚠️ Minimum amount is ${MIN_STARS} Stars.`);
    if (amount > MAX_STARS) return ctx.reply(`⚠️ Maximum amount is ${MAX_STARS} Stars.`);

    const usdtValue = (amount / 250) * RATE_USDT;

    ctx.reply(
      `✅ You’re selling *${amount} Stars*.\n` +
      `💵 You will receive approximately *${usdtValue.toFixed(2)} USDT*.\n\n` +
      `Once you click below, you’ll be redirected to pay with Stars.`,
      {
        parse_mode: "Markdown",
        ...Markup.inlineKeyboard([
          [Markup.button.callback("⭐ PAY WITH STARS", `PAY_${amount}`)]
        ])
      }
    );
    ctx.session.awaitingAmount = false;
  }
});

bot.action(/PAY_(\d+)/, async (ctx) => {
  const amount = ctx.match[1];
  await ctx.reply(
    `💫 To complete the transaction:\n\n` +
    `1️⃣ Pay ${amount} Stars via Telegram.\n` +
    `2️⃣ Once done, please send a screenshot proof here.\n\n` +
    `💰 Your payout (USDT/TON) will be processed manually by admin.`
  );

  await bot.telegram.sendMessage(
    ctx.chat.id,
    `📨 Admin will verify your payment soon.`
  );

  // Notify admin
  await bot.telegram.sendMessage(
    `@${ADMIN_USERNAME}`,
    `📩 New Sell Request:\n\n👤 User: @${ctx.from.username || ctx.from.first_name}\n💫 Stars: ${amount}`
  );
});

bot.launch();
console.log("🚀 Bot is running...");
