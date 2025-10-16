require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const bodyParser = require('body-parser');

const { createClient, createTransaction } = require('./helpers/coinpayments');
const state = require('./helpers/state');

const TOKEN = process.env.TELEGRAM_TOKEN;
if (!TOKEN) {
  console.error('Please set TELEGRAM_TOKEN in .env');
  process.exit(1);
}

const useWebhook = process.env.USE_WEBHOOK === 'true';
const port = process.env.PORT || 3000;

const bot = new TelegramBot(TOKEN, { polling: !useWebhook });

let cpClient = createClient(process.env.COINPAYMENTS_PUBLIC_KEY, process.env.COINPAYMENTS_PRIVATE_KEY);
const REFUND_EMAIL = process.env.COINPAYMENTS_REFUND_EMAIL || '';

const RATES = {
  description: `Rates:\nUSD → EUR = 0.89 EUR\nUSDT → GBP = 0.77 GBP\nUSD → USDT = 1.08`,
  usd_to_eur: 0.89,
  usdt_to_gbp: 0.77,
  usd_to_usdt: 1.08
};

function askSell(chatId, first_name, last_name) {
  const welcome = `Hello ${first_name || ''} ${last_name || ''},\n\nWelcome — this bot helps you sell USDT for fiat.\nDo you want to sell USDT now?`;
  const opts = {
    reply_markup: {
      inline_keyboard: [[
        { text: 'YES', callback_data: 'sell_yes' },
        { text: 'NO', callback_data: 'sell_no' }
      ]]
    }
  };
  bot.sendMessage(chatId, welcome + '\n\n' + RATES.description, opts);
}

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const first = msg.from.first_name || '';
  const last = msg.from.last_name || '';
  state.clear(msg.from.id);
  askSell(chatId, first, last);
});

bot.on('callback_query', async (callbackQuery) => {
  const data = callbackQuery.data;
  const chatId = callbackQuery.message.chat.id;
  const userId = callbackQuery.from.id;
  const sess = state.get(userId);

  try {
    if (data === 'sell_no') {
      await bot.sendMessage(chatId, 'No problem — if you change your mind, send /start to begin.');
      return;
    }

    if (data === 'sell_yes') {
      // Ask which fiat they want to receive
      await bot.sendMessage(chatId, 'Great. Which fiat currency would you like to receive?', {
        reply_markup: {
          inline_keyboard: [
            [ { text: 'USD', callback_data: 'fiat_USD' }, { text: 'EUR', callback_data: 'fiat_EUR' }, { text: 'GBP', callback_data: 'fiat_GBP' } ]
          ]
        }
      });
      sess.step = 'choose_fiat';
      state.set(userId, sess);
      return;
    }

    if (data && data.startsWith('fiat_')) {
      const fiat = data.split('_')[1];
      sess.fiat = fiat;
      sess.step = 'choose_network';
      state.set(userId, sess);
      await bot.sendMessage(chatId, `You chose ${fiat}. Now choose the USDT network for deposit:`, {
        reply_markup: {
          inline_keyboard: [
            [ { text: 'USDT BEP20', callback_data: 'network_BEP20' } ],
            [ { text: 'USDT TRC20', callback_data: 'network_TRC20' } ],
            [ { text: 'USDT ERC20', callback_data: 'network_ERC20' } ]
          ]
        }
      });
      return;
    }

    if (data && data.startsWith('network_')) {
      const network = data.split('_')[1];
      sess.network = network;
      sess.step = 'choose_method';
      state.set(userId, sess);
      await bot.sendMessage(chatId, `Network set to ${network}. Choose the payment method you want to receive:`, {
        reply_markup: {
          inline_keyboard: [
            [ { text: 'Wise', callback_data: 'method_Wise' }, { text: 'Revolut', callback_data: 'method_Revolut' } ],
            [ { text: 'PayPal', callback_data: 'method_PayPal' }, { text: 'Bank Transfer', callback_data: 'method_Bank' } ],
            [ { text: 'Skrill/Neteller', callback_data: 'method_Skrill' }, { text: 'Card (Visa/Master)', callback_data: 'method_Card' } ],
            [ { text: 'Payeer', callback_data: 'method_Payeer' }, { text: 'Alipay', callback_data: 'method_Alipay' } ]
          ]
        }
      });
      return;
    }

    if (data && data.startsWith('method_')) {
      const method = data.split('_')[1];
      sess.method = method;
      sess.step = 'collect_payment_info';
      state.set(userId, sess);

      // Ask for specific details per method
      let ask = '';
      switch (method) {
        case 'Wise':
          ask = 'Please send your Wise email or Wise tag (e.g. @username).';
          break;
        case 'Revolut':
          ask = 'Please send your Revolut tag (revtag or @username).';
          break;
        case 'PayPal':
          ask = 'Please send your PayPal email.';
          break;
        case 'Bank':
          ask = 'Please provide your bank details: First name, Last name, IBAN, SWIFT/BIC.';
          break;
        case 'Skrill':
          ask = 'Please provide your Skrill or Neteller email.';
          break;
        case 'Card':
          ask = 'Please provide your card number (Visa/Mastercard).';
          break;
        case 'Payeer':
          ask = 'Please provide your Payeer number.';
          break;
        case 'Alipay':
          ask = 'Please provide your Alipay email.';
          break;
        default:
          ask = 'Please provide your payout details.';
      }

      await bot.sendMessage(chatId, ask);
      return;
    }

  } catch (err) {
    console.error('callback_query error', err);
    await bot.sendMessage(chatId, 'Sorry, something went wrong. Please try again later.');
  }
});

// Catch plain text replies (used to collect payment info and amount)
bot.on('message', async (msg) => {
  // ignore messages that are commands or callback_query inbound messages (they come separately)
  if (!msg.text || msg.text.startsWith('/')) return;

  const userId = msg.from.id;
  const sess = state.get(userId);
  const chatId = msg.chat.id;

  try {
    if (!sess || !sess.step) return; // nothing expected

    if (sess.step === 'collect_payment_info') {
      // Save payment info and ask how much USDT they want to sell
      sess.payment_info = msg.text.trim();
      sess.step = 'ask_amount';
      state.set(userId, sess);
      await bot.sendMessage(chatId, 'How much USDT would you like to sell? (Enter amount as number, e.g. 100)');
      return;
    }

    if (sess.step === 'ask_amount') {
      const amountUSDT = parseFloat(msg.text.replace(/,/g, ''));
      if (isNaN(amountUSDT) || amountUSDT <= 0) {
        await bot.sendMessage(chatId, 'Please send a valid numeric amount (e.g. 100).');
        return;
      }

      sess.amount_usdt = amountUSDT;
      sess.step = 'create_deposit';
      state.set(userId, sess);

      // Calculate amount in USD equivalent using RATES.usd_to_usdt (USD -> USDT = 1.08 meaning 1 USD buys 1.08 USDT).
      // To compute USD required to buy amountUSDT: USD_required = amountUSDT / (usd_to_usdt)
      const usdRequired = amountUSDT / RATES.usd_to_usdt;

      await bot.sendMessage(chatId, `Creating deposit for ${amountUSDT} USDT.\nEstimated fiat (USD) to pay: ${usdRequired.toFixed(2)} USD.\nWe will create a CoinPayments deposit address for you now...`);

      // Use CoinPayments to create a transaction. buyer_email used for refund address/contact (from .env or session)
      const buyerEmail = process.env.COINPAYMENTS_REFUND_EMAIL || '';

      try {
        const tx = await createTransaction(cpClient, usdRequired.toFixed(2), 'USD', 'USDT', buyerEmail);
        // tx should contain: amount, address, timeout, status_url, qrcode_url, etc.
        sess.tx = tx;
        sess.step = 'await_payment';
        state.set(userId, sess);

        // Send transaction details to user
        let reply = `✅ Deposit created:\n`;
        if (tx && tx.amount) reply += `Amount (crypto): ${tx.amount} ${tx.coin} \n`;
        if (tx && tx.dest_tag) reply += `Dest tag: ${tx.dest_tag}\n`;
        if (tx && tx.address) reply += `Send USDT to: ${tx.address} \n`;
        if (tx && tx.checkout_url) reply += `Payment page: ${tx.checkout_url} \n`;
        if (tx && tx.qrcode_url) reply += `QR: ${tx.qrcode_url} \n`;
        if (tx && tx.status_url) reply += `Status page: ${tx.status_url} \n`;

        reply += `\nWe recorded your payout method: ${sess.method} — ${sess.payment_info}\nOnce we detect the payment you will receive the fiat to your chosen method.\nIf you need support, reply here.`;

        await bot.sendMessage(chatId, reply);
        return;
      } catch (err) {
        console.error('CoinPayments createTransaction error', err);
        await bot.sendMessage(chatId, 'Failed to create CoinPayments transaction. Please contact support or try again later.');
        sess.step = null;
        state.set(userId, sess);
        return;
      }
    }

    // If waiting for nothing, ignore
  } catch (err) {
    console.error('message handler error', err);
    await bot.sendMessage(chatId, 'Sorry, something went wrong while processing your message.');
  }
});

// Simple express webhook entry if using webhook mode (for Sevalla)
if (useWebhook) {
  const app = express();
  app.use(bodyParser.json());

  app.post(`/bot${TOKEN}`, (req, res) => {
    bot.processUpdate(req.body);
    res.sendStatus(200);
  });

  app.get('/', (req, res) => res.send('Telegram USDT Sell Bot running'));

  app.listen(port, () => {
    console.log('Express server listening on port', port);
  });
}

console.log('Bot started (polling:', !useWebhook, ')');
