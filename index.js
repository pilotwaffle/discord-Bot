// Prince Bot v2.0 — Live prices + AI chat
require('dotenv').config();
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } = require('discord.js');

const token = process.env.BOT_TOKEN || process.env.DISCORD_BOT_TOKEN;
const zaiKey = process.env.ZAI_API_KEY;

console.log('Token present:', !!token, 'length:', (token || '').length);
console.log('ZAI key present:', !!zaiKey);

if (!token) {
  console.error('DISCORD_BOT_TOKEN is not set. Exiting.');
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const APPLICATION_ID = '1490405331665424564';

const SYSTEM_PROMPT = `You are Prince, an AI assistant in a Discord server. You talk like a real one — short, direct, no fluff. You keep it casual but you know your stuff. You're like a leader who keeps it real.

How you talk:
- Short responses. No essays. Get to the point.
- Casual but confident. You don't over-explain.
- Dry humor when it fits. Don't force it.
- You can help with anything — general knowledge, gaming, finance, crypto, tech, life advice, whatever.
- If someone's got drama, you mediate — keep it real, call it like you see it.
- You say things like "smh", "move on past that", "good job", "that could've been avoided" when it fits naturally.
- Never start with "As an AI" or any corny disclaimer. You're Prince. Act like it.
- Keep responses under 2000 characters (Discord limit).
- When given live price data, present it cleanly and add brief commentary.`;

// ============ LIVE PRICE LOOKUPS ============

// Common crypto ticker → CoinGecko ID mapping
const CRYPTO_MAP = {
  btc: 'bitcoin', bitcoin: 'bitcoin',
  eth: 'ethereum', ethereum: 'ethereum',
  sol: 'solana', solana: 'solana',
  xrp: 'ripple', ripple: 'ripple',
  doge: 'dogecoin', dogecoin: 'dogecoin',
  ada: 'cardano', cardano: 'cardano',
  dot: 'polkadot', polkadot: 'polkadot',
  matic: 'matic-network', polygon: 'matic-network',
  avax: 'avalanche-2', avalanche: 'avalanche-2',
  link: 'chainlink', chainlink: 'chainlink',
  shib: 'shiba-inu',
  bnb: 'binancecoin',
  ltc: 'litecoin', litecoin: 'litecoin',
  zil: 'zilliqa', zilliqa: 'zilliqa',
  sui: 'sui',
  apt: 'aptos', aptos: 'aptos',
  arb: 'arbitrum', arbitrum: 'arbitrum',
  op: 'optimism', optimism: 'optimism',
  pepe: 'pepe',
};

async function getCryptoPrice(coinId) {
  try {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/coins/${coinId}?localization=false&tickers=false&community_data=false&developer_data=false`
    );
    if (!res.ok) return null;
    const data = await res.json();
    return {
      name: data.name,
      symbol: data.symbol.toUpperCase(),
      price: data.market_data.current_price.usd,
      change24h: data.market_data.price_change_percentage_24h,
      high24h: data.market_data.high_24h.usd,
      low24h: data.market_data.low_24h.usd,
      marketCap: data.market_data.market_cap.usd,
      volume: data.market_data.total_volume.usd,
    };
  } catch (e) {
    console.error('CoinGecko error:', e.message);
    return null;
  }
}

async function getStockPrice(ticker) {
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=1d`
    );
    if (!res.ok) return null;
    const data = await res.json();
    const result = data.chart?.result?.[0];
    if (!result) return null;
    const meta = result.meta;
    const prevClose = meta.chartPreviousClose || meta.previousClose;
    const price = meta.regularMarketPrice;
    const change = price - prevClose;
    const changePct = (change / prevClose) * 100;
    return {
      symbol: meta.symbol,
      name: meta.shortName || meta.symbol,
      price,
      change,
      changePct,
      high: meta.regularMarketDayHigh,
      low: meta.regularMarketDayLow,
      volume: meta.regularMarketVolume,
      marketState: meta.marketState,
    };
  } catch (e) {
    console.error('Yahoo Finance error:', e.message);
    return null;
  }
}

function formatNum(n) {
  if (!n && n !== 0) return 'N/A';
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1) return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return `$${n.toFixed(6)}`;
}

function formatCryptoResponse(d) {
  const arrow = d.change24h >= 0 ? '📈' : '📉';
  const sign = d.change24h >= 0 ? '+' : '';
  return `**${d.name} (${d.symbol})** ${arrow}

**Price:** ${formatNum(d.price)}
**24h Change:** ${sign}${d.change24h?.toFixed(2)}%
**24h Range:** ${formatNum(d.low24h)} — ${formatNum(d.high24h)}
**Volume:** ${formatNum(d.volume)}
**Market Cap:** ${formatNum(d.marketCap)}`;
}

function formatStockResponse(d) {
  const arrow = d.change >= 0 ? '📈' : '📉';
  const sign = d.change >= 0 ? '+' : '';
  const state = d.marketState === 'REGULAR' ? '🟢 Market Open' : '🔴 Market Closed';
  return `**${d.name} (${d.symbol})** ${arrow}  ${state}

**Price:** ${formatNum(d.price)}
**Change:** ${sign}${formatNum(Math.abs(d.change))} (${sign}${d.changePct?.toFixed(2)}%)
**Day Range:** ${formatNum(d.low)} — ${formatNum(d.high)}
**Volume:** ${d.volume?.toLocaleString() || 'N/A'}`;
}

// Detect price queries and extract ticker
function detectPriceQuery(text) {
  const lower = text.toLowerCase();
  const SKIP = ['the', 'a', 'an', 'my', 'your', 'is', 'are', 'was', 'today', 'now', 'me', 'it', 'price', 'value', 'cost', 'worth', 'check', 'search', 'look', 'how', 'much', 'what', 'whats', 'for', 'of', 'up', 'at', 'get'];

  const pricePatterns = [
    // "price of MSTR", "cost of BTC", "value of ETH"
    /(?:price|value|cost|worth)\s+(?:of|for)\s+(?:the\s+)?(\w+)/i,
    // "what's MSTR at", "what's BTC trading at"
    /what'?s?\s+(?:the\s+)?(\w+)\s+(?:at|trading|worth|doing|looking)/i,
    // "how's ETH doing", "how is BTC"
    /how'?s?\s+(?:the\s+)?(\w+)\s+(?:doing|looking|trading)/i,
    // "check MSTR", "search BTC", "look up ETH"
    /(?:check|search|look\s*up)\s+(?:the\s+)?(?:price\s+(?:of\s+)?)?(?:the\s+)?(\w+)/i,
    // "MSTR price", "BTC value"
    /(\w+)\s+(?:price|value|cost|stock)/i,
    // "what's the price of MSTR" — match the last word
    /price\s+of\s+(\w+)/i,
    // "how much is MSTR"
    /how\s+much\s+is\s+(\w+)/i,
  ];

  for (const pattern of pricePatterns) {
    const match = lower.match(pattern);
    if (match) {
      const ticker = match[1].replace('$', '').toLowerCase();
      if (SKIP.includes(ticker)) continue;
      return ticker;
    }
  }

  // Last resort: find any known ticker in the text
  const words = lower.split(/\s+/);
  for (const word of words) {
    const clean = word.replace(/[^a-z]/g, '');
    if (CRYPTO_MAP[clean]) return clean;
  }

  return null;
}

async function handlePriceQuery(ticker) {
  // Check crypto first
  const cryptoId = CRYPTO_MAP[ticker];
  if (cryptoId) {
    const data = await getCryptoPrice(cryptoId);
    if (data) return formatCryptoResponse(data);
  }

  // Try as stock ticker
  const stockData = await getStockPrice(ticker.toUpperCase());
  if (stockData) return formatStockResponse(stockData);

  // Try crypto search if not in map (CoinGecko search)
  if (!cryptoId) {
    try {
      const searchRes = await fetch(`https://api.coingecko.com/api/v3/search?query=${ticker}`);
      if (searchRes.ok) {
        const searchData = await searchRes.json();
        const coin = searchData.coins?.[0];
        if (coin) {
          const data = await getCryptoPrice(coin.id);
          if (data) return formatCryptoResponse(data);
        }
      }
    } catch {}
  }

  return null;
}

// ============ AI CHAT ============

const channelHistory = new Map();
const MAX_HISTORY = 10;

function getHistory(channelId) {
  if (!channelHistory.has(channelId)) channelHistory.set(channelId, []);
  return channelHistory.get(channelId);
}

function addToHistory(channelId, role, content) {
  const history = getHistory(channelId);
  history.push({ role, content });
  if (history.length > MAX_HISTORY) history.shift();
}

async function chatWithGLM(channelId, userMessage, extraContext) {
  const history = getHistory(channelId);
  let systemPrompt = SYSTEM_PROMPT;
  if (extraContext) {
    systemPrompt += `\n\nHere is live data to include in your response:\n${extraContext}`;
  }

  const messages = [
    { role: 'system', content: systemPrompt },
    ...history,
    { role: 'user', content: userMessage },
  ];

  const res = await fetch('https://api.z.ai/api/paas/v4/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${zaiKey}`,
    },
    body: JSON.stringify({
      model: 'glm-4.7-flash',
      messages,
      max_tokens: 1024,
      temperature: 0.8,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error('GLM API error:', res.status, err);
    return "Something's off right now. Try again in a sec.";
  }

  const data = await res.json();
  const msg = data.choices?.[0]?.message;
  const reply = msg?.content || msg?.reasoning_content || "Got nothing. Try again.";

  addToHistory(channelId, 'user', userMessage);
  addToHistory(channelId, 'assistant', reply);

  return reply;
}

// ============ MAIN HANDLER ============

async function handleQuestion(channelId, question) {
  // Check if it's a price query
  const ticker = detectPriceQuery(question);
  if (ticker) {
    const priceData = await handlePriceQuery(ticker);
    if (priceData) {
      // Feed live data to GLM for Prince-style commentary
      const reply = await chatWithGLM(channelId, question, priceData);
      return reply;
    }
  }
  // Regular AI chat
  return chatWithGLM(channelId, question);
}

// ============ DISCORD EVENTS ============

client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}!`);

  const commands = [
    new SlashCommandBuilder()
      .setName('ping')
      .setDescription('Replies with Pong!'),
    new SlashCommandBuilder()
      .setName('ask')
      .setDescription('Ask Prince anything')
      .addStringOption(opt =>
        opt.setName('question').setDescription('Your question').setRequired(true)
      ),
    new SlashCommandBuilder()
      .setName('price')
      .setDescription('Get live price of a crypto or stock')
      .addStringOption(opt =>
        opt.setName('ticker').setDescription('Ticker symbol (e.g. BTC, MSTR, ETH)').setRequired(true)
      ),
  ];

  const rest = new REST().setToken(token);
  try {
    await rest.put(Routes.applicationCommands(APPLICATION_ID), {
      body: commands.map(cmd => cmd.toJSON()),
    });
    console.log('Slash commands registered.');
  } catch (error) {
    console.error('Failed to register slash commands:', error);
  }
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'ping') {
    await interaction.reply('Pong!');
  }

  if (interaction.commandName === 'ask') {
    await interaction.deferReply();
    const question = interaction.options.getString('question');
    const reply = await handleQuestion(interaction.channelId, question);
    await interaction.editReply(reply);
  }

  if (interaction.commandName === 'price') {
    await interaction.deferReply();
    const ticker = interaction.options.getString('ticker').toLowerCase();
    const priceData = await handlePriceQuery(ticker);
    if (priceData) {
      await interaction.editReply(priceData);
    } else {
      await interaction.editReply(`Couldn't find price data for "${ticker}". Check the ticker and try again.`);
    }
  }
});

// Dedup: track recently processed messages to prevent double responses
const processedMessages = new Set();

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (processedMessages.has(message.id)) return;
  processedMessages.add(message.id);
  setTimeout(() => processedMessages.delete(message.id), 30000);

  if (message.content === '!ping') {
    message.reply('Pong!');
    return;
  }

  if (message.content.startsWith('!ask ')) {
    const question = message.content.slice(5).trim();
    if (!question) return;
    await message.channel.sendTyping();
    const reply = await handleQuestion(message.channelId, question);
    message.reply(reply);
    return;
  }

  if (message.content.startsWith('!price ')) {
    const ticker = message.content.slice(7).trim().toLowerCase();
    if (!ticker) return;
    await message.channel.sendTyping();
    const priceData = await handlePriceQuery(ticker);
    message.reply(priceData || `Couldn't find "${ticker}". Check the ticker.`);
    return;
  }

  if (message.mentions.has(client.user)) {
    if (message.reference) {
      try {
        const ref = await message.fetchReference();
        if (ref.author.id === client.user.id) return;
      } catch {}
    }
    const question = message.content.replace(/<@!?\d+>/g, '').trim();
    if (!question) return;
    await message.channel.sendTyping();
    const reply = await handleQuestion(message.channelId, question);
    message.reply(reply);
  }
});

client.login(token);
