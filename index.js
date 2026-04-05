require('dotenv').config({ override: false });

// Debug: check if env vars are loaded
console.log('DISCORD_BOT_TOKEN exists:', !!process.env.DISCORD_BOT_TOKEN);
console.log('DISCORD_BOT_TOKEN length:', (process.env.DISCORD_BOT_TOKEN || '').length);
console.log('ZAI_API_KEY exists:', !!process.env.ZAI_API_KEY);
console.log('All env keys:', Object.keys(process.env).filter(k => k.includes('DISCORD') || k.includes('ZAI') || k.includes('TOKEN')));

const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } = require('discord.js');

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
- Keep responses under 2000 characters (Discord limit).`;

// Per-channel conversation history (last 10 messages)
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

async function chatWithGLM(channelId, userMessage) {
  const history = getHistory(channelId);
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...history,
    { role: 'user', content: userMessage },
  ];

  const res = await fetch('https://api.z.ai/api/paas/v4/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.ZAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'glm-4.7',
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
  const reply = data.choices?.[0]?.message?.content || "Got nothing. Try again.";

  addToHistory(channelId, 'user', userMessage);
  addToHistory(channelId, 'assistant', reply);

  return reply;
}

// Register slash commands on startup
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
  ];

  const rest = new REST().setToken(process.env.DISCORD_BOT_TOKEN);
  try {
    await rest.put(Routes.applicationCommands(APPLICATION_ID), {
      body: commands.map(cmd => cmd.toJSON()),
    });
    console.log('Slash commands registered.');
  } catch (error) {
    console.error('Failed to register slash commands:', error);
  }
});

// Handle slash commands
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'ping') {
    await interaction.reply('Pong!');
  }

  if (interaction.commandName === 'ask') {
    await interaction.deferReply();
    const question = interaction.options.getString('question');
    const reply = await chatWithGLM(interaction.channelId, question);
    await interaction.editReply(reply);
  }
});

// Handle messages: @Prince mentions and !ask prefix
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  // !ping legacy command
  if (message.content === '!ping') {
    message.reply('Pong!');
    return;
  }

  // !ask <question>
  if (message.content.startsWith('!ask ')) {
    const question = message.content.slice(5).trim();
    if (!question) return;
    await message.channel.sendTyping();
    const reply = await chatWithGLM(message.channelId, question);
    message.reply(reply);
    return;
  }

  // @Prince mention
  if (message.mentions.has(client.user)) {
    const question = message.content.replace(/<@!?\d+>/g, '').trim();
    if (!question) return;
    await message.channel.sendTyping();
    const reply = await chatWithGLM(message.channelId, question);
    message.reply(reply);
  }
});

client.login(process.env.DISCORD_BOT_TOKEN);
