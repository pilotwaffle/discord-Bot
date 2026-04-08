// Alpaca paper trading client for Discord bot
const TRADING_BASE = 'https://paper-api.alpaca.markets';
const DATA_BASE = 'https://data.alpaca.markets';

const headers = () => ({
  'APCA-API-KEY-ID': process.env.ALPACA_API_KEY,
  'APCA-API-SECRET-KEY': process.env.ALPACA_SECRET_KEY,
  'Content-Type': 'application/json',
});

async function req(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: headers(),
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { error: text }; }
  return { status: res.status, data };
}

const trading = (method, path, body) => req(method, `${TRADING_BASE}${path}`, body);
const dataApi = (path) => req('GET', `${DATA_BASE}${path}`);

// Account
async function getAccount() {
  const { status, data } = await trading('GET', '/v2/account');
  return status === 200 ? data : null;
}

async function getClock() {
  const { data } = await trading('GET', '/v2/clock');
  return data;
}

// Positions
async function getPositions() {
  const { status, data } = await trading('GET', '/v2/positions');
  return status === 200 ? data : [];
}

// Orders
async function submitOrder(symbol, qty, side = 'buy', type = 'market') {
  return trading('POST', '/v2/orders', {
    symbol: symbol.toUpperCase(),
    qty: String(qty),
    side,
    type,
    time_in_force: 'day',
  });
}

async function listOrders(status = 'open') {
  const { data } = await trading('GET', `/v2/orders?status=${status}&limit=20`);
  return Array.isArray(data) ? data : [];
}

async function cancelAllOrders() {
  return trading('DELETE', '/v2/orders');
}

// Market data
async function getSnapshot(symbol) {
  const { status, data } = await dataApi(`/v2/stocks/${symbol.toUpperCase()}/snapshot`);
  return status === 200 ? data : null;
}

// ============ FORMATTERS ============

function fmt(n) {
  if (n === null || n === undefined) return 'N/A';
  const num = Number(n);
  if (isNaN(num)) return String(n);
  return `$${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatAccount(acct, clock, positions, orders) {
  if (!acct) return 'Could not connect to Alpaca.';
  const state = clock?.is_open ? '🟢 OPEN' : '🔴 CLOSED';
  let out = `**📊 Paper Account ${acct.account_number}**  ${state}\n`;
  out += `**Equity:** ${fmt(acct.equity)}  •  **Cash:** ${fmt(acct.cash)}  •  **BP:** ${fmt(acct.buying_power)}\n`;
  out += `\n**Positions (${positions.length}):**\n`;
  if (positions.length === 0) {
    out += '_(none)_\n';
  } else {
    for (const p of positions) {
      const pl = Number(p.unrealized_pl);
      const plPct = Number(p.unrealized_plpc) * 100;
      const arrow = pl >= 0 ? '📈' : '📉';
      const sign = pl >= 0 ? '+' : '';
      out += `${arrow} **${p.symbol}** ${p.qty} @ ${fmt(p.avg_entry_price)} → ${fmt(p.current_price)}  ${sign}${fmt(Math.abs(pl))} (${sign}${plPct.toFixed(2)}%)\n`;
    }
  }
  out += `\n**Open orders (${orders.length}):**\n`;
  if (orders.length === 0) {
    out += '_(none)_';
  } else {
    for (const o of orders) {
      out += `• ${o.side.toUpperCase()} ${o.qty} ${o.symbol} ${o.type} [${o.status}]\n`;
    }
  }
  return out.slice(0, 2000);
}

function formatOrderResult(status, order, action) {
  if (status !== 200) {
    return `❌ Order failed: ${order.message || JSON.stringify(order)}`;
  }
  return `✅ ${action.toUpperCase()} order accepted\n**${order.qty} ${order.symbol}** @ market\nOrder ID: \`${order.id}\`\nStatus: ${order.status}`;
}

module.exports = {
  getAccount,
  getClock,
  getPositions,
  submitOrder,
  listOrders,
  cancelAllOrders,
  getSnapshot,
  formatAccount,
  formatOrderResult,
};
