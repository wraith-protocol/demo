// Design tokens
const T = {
  surface: '#0e0e0e',
  container: '#141414',
  bright: '#1a1a1a',
  primary: '#c6c6c7',
  onSurface: '#e6e1e5',
  onVariant: '#c4c7c5',
  outline: '#767575',
  outlineVariant: '#444444',
  error: '#ee7d77',
  tertiary: '#22c55e',
};

const css = `
  @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;600;700&family=Inter:wght@400;500&family=JetBrains+Mono:wght@400;500&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: ${T.surface}; color: ${T.onSurface}; font-family: 'Inter', sans-serif; }
  .heading { font-family: 'Space Grotesk', sans-serif; }
  .mono { font-family: 'JetBrains Mono', monospace; }
  .label { font-family: 'JetBrains Mono', monospace; font-size: 10px; text-transform: uppercase; letter-spacing: 0.12em; color: ${T.outline}; }
  .page { padding: 32px; background: ${T.surface}; min-height: 100vh; }
  .page.mobile { padding: 20px; }
  .chain-tag { font-family: 'JetBrains Mono', monospace; font-size: 10px; text-transform: uppercase; letter-spacing: 0.12em; color: ${T.outline}; margin-bottom: 6px; }
  h1 { font-family: 'Space Grotesk', sans-serif; font-size: 28px; font-weight: 700; text-transform: uppercase; letter-spacing: -0.02em; color: ${T.onSurface}; margin-bottom: 6px; }
  .subtitle { font-size: 13px; color: ${T.onVariant}; line-height: 1.5; margin-bottom: 28px; }
  .field { display: flex; flex-direction: column; gap: 6px; margin-bottom: 20px; }
  .input { height: 48px; background: ${T.surface}; border: 1px solid ${T.outlineVariant}; color: ${T.primary}; font-family: 'JetBrains Mono', monospace; font-size: 13px; padding: 0 16px; width: 100%; display: flex; align-items: center; position: relative; }
  .input.large { height: 64px; font-size: 28px; }
  .input .unit { position: absolute; right: 12px; font-family: 'JetBrains Mono', monospace; font-size: 11px; color: ${T.outline}; }
  .input .paste-btn { position: absolute; right: 12px; font-family: 'Space Grotesk', sans-serif; font-size: 10px; text-transform: uppercase; letter-spacing: 0.1em; color: ${T.outline}; }
  .input.focused { border-color: ${T.primary}; }
  .input.error-border { border-color: ${T.error}; }
  .placeholder { color: ${T.outline}; }
  .btn-primary { height: 48px; background: ${T.primary}; color: ${T.surface}; font-family: 'Space Grotesk', sans-serif; font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.1em; border: none; width: 100%; display: flex; align-items: center; justify-content: center; cursor: pointer; }
  .btn-primary.disabled { opacity: 0.3; }
  .btn-primary.loading { opacity: 0.6; }
  .btn-outline { height: 44px; background: transparent; color: ${T.primary}; font-family: 'Space Grotesk', sans-serif; font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.1em; border: 1px solid ${T.outlineVariant}; display: flex; align-items: center; justify-content: center; cursor: pointer; }
  .panel { background: ${T.container}; border: 1px solid ${T.outlineVariant}; padding: 20px; margin-bottom: 16px; }
  .panel.dim { opacity: 0.4; }
  .meta-addr { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: ${T.primary}; word-break: break-all; line-height: 1.6; margin-top: 4px; }
  .row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .dot { width: 6px; height: 6px; display: inline-block; flex-shrink: 0; }
  .dot.green { background: ${T.tertiary}; }
  .dot.pulse { background: ${T.primary}; }
  .error-text { font-size: 13px; color: ${T.error}; margin-top: 8px; }
  .meta-row { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
  .copy-btn { font-family: 'JetBrains Mono', monospace; font-size: 9px; text-transform: uppercase; letter-spacing: 0.1em; color: ${T.outline}; border: 1px solid ${T.outlineVariant}; padding: 2px 6px; background: transparent; }
  .divider { border: none; border-top: 1px solid ${T.outlineVariant}; opacity: 0.3; margin: 12px 0; }
  .fee-row { display: flex; justify-content: space-between; margin-bottom: 6px; }
  .step-num { font-family: 'JetBrains Mono', monospace; font-size: 10px; color: ${T.outline}; margin-right: 10px; }
  .step-title { font-family: 'Space Grotesk', sans-serif; font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; color: ${T.onSurface}; }
  .step-body { font-size: 12px; color: ${T.onVariant}; line-height: 1.5; margin: 8px 0 14px; }
  .check { color: ${T.tertiary}; font-family: 'JetBrains Mono', monospace; font-size: 11px; margin-right: 6px; }
  .skeleton { background: ${T.bright}; height: 14px; border-radius: 0; animation: pulse 1.2s ease-in-out infinite; }
  @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
  .flat-form { border: 1px solid ${T.outlineVariant}; }
  .flat-row { display: flex; align-items: center; padding: 0 16px; height: 48px; border-bottom: 1px solid ${T.outlineVariant}; gap: 16px; }
  .flat-row:last-child { border-bottom: none; }
  .flat-label { font-family: 'JetBrains Mono', monospace; font-size: 10px; text-transform: uppercase; letter-spacing: 0.1em; color: ${T.outline}; width: 80px; flex-shrink: 0; }
  .flat-val { font-family: 'JetBrains Mono', monospace; font-size: 12px; color: ${T.outline}; flex: 1; }
  .flat-right { font-family: 'JetBrains Mono', monospace; font-size: 10px; color: ${T.outline}; margin-left: auto; }
  .table { width: 100%; border-collapse: collapse; }
  .table th { font-family: 'JetBrains Mono', monospace; font-size: 9px; text-transform: uppercase; letter-spacing: 0.1em; color: ${T.outline}; text-align: left; padding: 8px 12px; border-bottom: 1px solid ${T.outlineVariant}; }
  .table td { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: ${T.primary}; padding: 10px 12px; border-bottom: 1px solid ${T.outlineVariant}; vertical-align: middle; }
  .table tr:last-child td { border-bottom: none; }
  .withdraw-btn { font-family: 'Space Grotesk', sans-serif; font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; background: ${T.primary}; color: ${T.surface}; border: none; padding: 4px 10px; height: 28px; cursor: pointer; white-space: nowrap; }
  .balance-val { font-family: 'Space Grotesk', sans-serif; font-size: 16px; font-weight: 700; color: ${T.onSurface}; }
  .empty-box { border: 1px solid ${T.outlineVariant}; padding: 40px 24px; text-align: center; }
  .empty-title { font-family: 'Space Grotesk', sans-serif; font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.1em; color: ${T.outline}; margin-bottom: 10px; }
  .empty-body { font-size: 12px; color: ${T.onVariant}; line-height: 1.5; margin-bottom: 16px; }
  .scan-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; }
  .found-count { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: ${T.onVariant}; }
  .withdraw-input { height: 36px; background: ${T.surface}; border: 1px solid ${T.outlineVariant}; color: ${T.primary}; font-family: 'JetBrains Mono', monospace; font-size: 11px; padding: 0 10px; flex: 1; }
  .reveal-btn { font-family: 'JetBrains Mono', monospace; font-size: 10px; text-transform: uppercase; letter-spacing: 0.1em; color: ${T.outline}; background: none; border: none; cursor: pointer; padding: 0; }
`;

// ─── helpers ────────────────────────────────────────────────────────────────

function page(width, content) {
  const isMobile = width <= 375;
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>${css}</style></head>
<body style="width:${width}px">
<div class="page${isMobile ? ' mobile' : ''}" style="max-width:${width}px">
${content}
</div></body></html>`;
}

function header(chain, title, subtitle) {
  return `<div class="chain-tag">${chain}</div>
<h1>${title}</h1>
<p class="subtitle">${subtitle}</p>`;
}

function field(label, placeholder, opts = {}) {
  const cls = ['input', opts.large ? 'large' : '', opts.focused ? 'focused' : '', opts.errBorder ? 'error-border' : ''].filter(Boolean).join(' ');
  const right = opts.unit
    ? `<span class="unit">${opts.unit}</span>`
    : opts.paste
    ? `<span class="paste-btn">Paste</span>`
    : '';
  return `<div class="field">
  <div class="label">${label}</div>
  <div class="${cls}" style="position:relative">
    <span class="placeholder">${placeholder}</span>${right}
  </div>
</div>`;
}

function btn(text, opts = {}) {
  const cls = ['btn-primary', opts.disabled ? 'disabled' : '', opts.loading ? 'loading' : ''].filter(Boolean).join(' ');
  return `<div class="${cls}">${text}</div>`;
}

function feeRow() {
  return `<hr class="divider">
<div class="fee-row"><span class="label">Network fee</span><span class="mono" style="font-size:10px;color:${T.onVariant}">100 stroops</span></div>
<div class="fee-row"><span class="label">Announcer</span><span class="mono" style="font-size:10px;color:${T.onVariant}">Soroban</span></div>`;
}

function metaPanel(addr) {
  return `<div class="panel" style="margin-bottom:16px">
  <div class="row" style="margin-bottom:6px">
    <span class="label">Your Stealth Meta-Address</span>
    <span class="copy-btn">Copy</span>
  </div>
  <div class="meta-addr">${addr || 'st:xlm:AAAA...BBBB...CCCC...DDDD'}</div>
</div>`;
}

function skeletonCard() {
  return `<div class="panel" style="margin-bottom:12px">
  <div class="skeleton" style="width:60%;margin-bottom:10px"></div>
  <div class="skeleton" style="width:40%;margin-bottom:16px"></div>
  <div class="skeleton" style="width:80%;height:32px"></div>
</div>`;
}

function stealthCard(addr, balance, opts = {}) {
  const balEl = opts.empty
    ? `<span class="mono" style="font-size:11px;color:${T.outline}">Empty</span>`
    : `<div class="row" style="gap:6px"><span class="dot green"></span><span class="balance-val">${balance} XLM</span></div>`;
  const withdrawEl = opts.empty || opts.withdrawn ? '' : `
  <div class="field" style="margin-top:12px;margin-bottom:0">
    <div class="label">Withdraw to</div>
    <div style="display:flex;gap:8px;margin-top:4px">
      <div class="withdraw-input"><span class="placeholder">Destination address (G...)</span></div>
      <div class="withdraw-btn">Withdraw</div>
    </div>
  </div>`;
  return `<div class="panel" style="margin-bottom:12px">
  <div class="row" style="margin-bottom:8px">
    <div style="min-width:0;flex:1">
      <div class="label">Stealth Address</div>
      <div style="display:flex;align-items:center;gap:6px;margin-top:3px">
        <span class="mono" style="font-size:11px;color:${T.primary};overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${addr}</span>
        <span class="copy-btn">↗</span>
      </div>
    </div>
    <div style="flex-shrink:0">${balEl}</div>
  </div>
  ${withdrawEl}
  <hr class="divider">
  <button class="reveal-btn">Reveal secret key</button>
</div>`;
}

// ─── SEND-A: Recipient-First ─────────────────────────────────────────────────

function sendA(width, state) {
  const isLoading = state === 'loading';
  const isError = state === 'error';
  return page(width, `
${header('Stellar Testnet / XLM', 'Send', 'Send XLM privately using stealth addresses.')}
${field('Recipient Meta-Address', 'st:xlm:...', { focused: state === 'idle', paste: true })}
${field('Amount', '0.0', { unit: 'XLM' })}
${feeRow()}
${isError ? `<p class="error-text" style="margin-bottom:12px">Enter a valid Stellar meta-address (st:xlm:...)</p>` : ''}
${btn(isLoading ? 'Confirm in wallet...' : 'Send Privately', { loading: isLoading })}
`);
}

// ─── SEND-B: Amount-First ────────────────────────────────────────────────────

function sendB(width, state) {
  const isLoading = state === 'loading';
  const isError = state === 'error';
  const isMobile = width <= 375;
  return page(width, `
${header('Stellar Testnet / XLM', 'Send', 'Send XLM privately using stealth addresses.')}
${field('Amount', '0.0', { large: true, focused: state === 'idle', unit: 'XLM' })}
${field('Recipient Meta-Address', 'st:xlm:...', { paste: true, errBorder: isError })}
${feeRow()}
${isError ? `<p class="error-text" style="margin-bottom:12px">Enter a valid Stellar meta-address (st:xlm:...)</p>` : ''}
${btn(isLoading ? 'Confirm in wallet...' : 'Send Privately', { loading: isLoading })}
`);
}

// ─── SEND-C: Flat Form ───────────────────────────────────────────────────────

function sendC(width, state) {
  const isLoading = state === 'loading';
  const isError = state === 'error';
  const formStyle = isLoading ? 'opacity:0.5' : '';
  return page(width, `
${header('Stellar Testnet / XLM', 'Send', 'Send XLM privately using stealth addresses.')}
<div class="flat-form" style="${formStyle};margin-bottom:16px">
  <div class="flat-row${isError ? ' error-border' : ''}">
    <span class="flat-label">Recipient</span>
    <span class="flat-val">st:xlm:...</span>
    <span class="flat-right">Paste</span>
  </div>
  <div class="flat-row">
    <span class="flat-label">Amount</span>
    <span class="flat-val">0.0</span>
    <span class="flat-right">XLM</span>
  </div>
</div>
<p class="label" style="margin-bottom:16px">fee 100 stroops · soroban announcer</p>
${isError ? `<p class="error-text" style="margin-bottom:12px">Enter a valid Stellar meta-address (st:xlm:...)</p>` : ''}
${btn(isLoading ? 'Confirm in wallet...' : 'Send Privately', { loading: isLoading })}
`);
}

// ─── RECEIVE-A: Dense Table ──────────────────────────────────────────────────

function receiveA(width, state) {
  const isLoading = state === 'loading';
  const isError = state === 'error';
  const isMobile = width <= 375;

  let tableContent;
  if (isLoading) {
    tableContent = `<div style="padding:16px">${skeletonCard()}${skeletonCard()}${skeletonCard()}</div>`;
  } else if (isError) {
    tableContent = `<p class="error-text" style="padding:16px">Scan failed — RPC unavailable. Try again.</p>`;
  } else if (state === 'idle') {
    tableContent = `<div style="padding:24px;text-align:center"><span class="label">Scan to see transfers</span></div>`;
  } else {
    if (isMobile) {
      tableContent = `
<div style="border-top:1px solid ${T.outlineVariant}">
  <div style="padding:12px 16px;border-bottom:1px solid ${T.outlineVariant}">
    <div class="row"><span class="mono" style="font-size:11px;color:${T.primary}">GABC...XYZ</span><span class="balance-val" style="font-size:14px">12.5 XLM</span></div>
    <div style="margin-top:8px">${`<div class="btn-primary" style="height:32px;font-size:11px">Withdraw</div>`}</div>
  </div>
  <div style="padding:12px 16px;border-bottom:1px solid ${T.outlineVariant}">
    <div class="row"><span class="mono" style="font-size:11px;color:${T.primary}">GDEF...UVW</span><span class="balance-val" style="font-size:14px">0.5 XLM</span></div>
    <div style="margin-top:8px">${`<div class="btn-primary" style="height:32px;font-size:11px">Withdraw</div>`}</div>
  </div>
  <div style="padding:12px 16px">
    <div class="row"><span class="mono" style="font-size:11px;color:${T.primary}">GHIJ...RST</span><span class="mono" style="font-size:11px;color:${T.outline}">Empty</span></div>
  </div>
</div>`;
    } else {
      tableContent = `<table class="table">
  <thead><tr><th>Address</th><th>Balance</th><th>Action</th></tr></thead>
  <tbody>
    <tr><td>GABC...XYZ <span style="color:${T.outline}">↗</span></td><td><span class="balance-val" style="font-size:14px">12.5 XLM</span></td><td><div class="withdraw-btn">Withdraw ▸</div></td></tr>
    <tr><td>GDEF...UVW <span style="color:${T.outline}">↗</span></td><td><span class="balance-val" style="font-size:14px">0.5 XLM</span></td><td><div class="withdraw-btn">Withdraw ▸</div></td></tr>
    <tr><td>GHIJ...RST <span style="color:${T.outline}">↗</span></td><td><span class="mono" style="font-size:11px;color:${T.outline}">Empty</span></td><td>—</td></tr>
  </tbody>
</table>`;
    }
  }

  return page(width, `
${header('Stellar Testnet / XLM', 'Receive', 'Derive your stealth keys, register on-chain, then scan for payments.')}
${metaPanel()}
<div class="scan-row">
  <div class="btn-primary" style="width:auto;padding:0 24px;height:44px;font-size:12px">${isLoading ? 'Scanning...' : 'Scan for Payments'}</div>
  ${state === 'idle' ? '' : `<span class="found-count">${isLoading || isError ? '' : '3 transfers found'}</span>`}
</div>
<div class="panel" style="padding:0;overflow:hidden">${tableContent}</div>
`);
}

// ─── RECEIVE-B: Card Stack ───────────────────────────────────────────────────

function receiveB(width, state) {
  const isLoading = state === 'loading';
  const isError = state === 'error';

  let cards;
  if (isLoading) {
    cards = skeletonCard() + skeletonCard();
  } else if (isError) {
    cards = `<p class="error-text">Scan failed — RPC unavailable. Try again.</p>`;
  } else if (state === 'idle') {
    cards = `<p class="mono" style="font-size:11px;color:${T.outline}">Scan to check for incoming transfers.</p>`;
  } else {
    cards = stealthCard('GABC...XYZ', '12.5000000') + stealthCard('GDEF...UVW', '0.5000000');
  }

  return page(width, `
${header('Stellar Testnet / XLM', 'Receive', 'Derive your stealth keys, register on-chain, then scan for payments.')}
${metaPanel()}
<div class="scan-row">
  <div class="btn-primary" style="width:auto;padding:0 24px;height:44px;font-size:12px">${isLoading ? 'Scanning...' : 'Scan for Payments'}</div>
  ${state !== 'idle' ? `<span class="found-count">${isLoading || isError ? '' : '2 transfers found'}</span>` : ''}
</div>
${cards}
`);
}

// ─── RECEIVE-C: Empty-State-First ────────────────────────────────────────────

function receiveC(width, state) {
  const isLoading = state === 'loading';
  const isError = state === 'error';

  // idle = step 1 active, no keys yet
  // loading = step 1 in progress
  // error = step 1 failed
  // For "scanned" state we reuse 'idle' with keys derived — show collapsed steps + results

  if (state === 'idle' || isLoading || isError) {
    const step1Btn = isLoading
      ? btn('Sign in wallet...', { loading: true })
      : btn('Derive Keys');
    return page(width, `
${header('Stellar Testnet / XLM', 'Receive', 'Derive your stealth keys, register on-chain, then scan for payments.')}
<div class="panel" style="margin-bottom:12px">
  <div style="display:flex;align-items:baseline;gap:8px;margin-bottom:8px">
    <span class="step-num">01</span><span class="step-title">Derive Keys</span>
  </div>
  <p class="step-body">Sign once with Freighter to generate your stealth keys.</p>
  ${step1Btn}
  ${isError ? `<p class="error-text" style="margin-top:10px">Key derivation failed. Try again.</p>` : ''}
</div>
<div class="panel dim" style="margin-bottom:12px">
  <div style="display:flex;align-items:baseline;gap:8px">
    <span class="step-num">02</span><span class="step-title">Register</span>
  </div>
  <p class="step-body" style="margin-top:6px;margin-bottom:0;font-size:11px">Complete step 01 first.</p>
</div>
<div class="panel dim">
  <div style="display:flex;align-items:baseline;gap:8px">
    <span class="step-num">03</span><span class="step-title">Scan</span>
  </div>
  <p class="step-body" style="margin-top:6px;margin-bottom:0;font-size:11px">Complete step 02 first.</p>
</div>
`);
  }

  // "scanned" — show collapsed steps + results (0 matches = empty state)
  return page(width, `
${header('Stellar Testnet / XLM', 'Receive', 'Derive your stealth keys, register on-chain, then scan for payments.')}
<div class="panel" style="margin-bottom:8px;padding:12px 20px">
  <div style="display:flex;align-items:center;gap:8px">
    <span class="check">✓</span><span class="step-num">01</span><span class="step-title" style="font-size:12px">Derive Keys</span>
    <span class="mono" style="font-size:10px;color:${T.outline};margin-left:auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">st:xlm:AAAA...ZZZZ</span>
    <span class="copy-btn">Copy</span>
  </div>
</div>
<div class="panel" style="margin-bottom:16px;padding:12px 20px">
  <div style="display:flex;align-items:center;gap:8px">
    <span class="check">✓</span><span class="step-num">02</span><span class="step-title" style="font-size:12px">Registered</span>
    <span class="mono" style="font-size:10px;color:${T.outline};margin-left:auto">tx 3f2a... ↗</span>
  </div>
</div>
<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
  <span class="step-num">03</span><span class="step-title">Scan</span>
</div>
<div class="scan-row">
  <div class="btn-primary" style="width:auto;padding:0 24px;height:44px;font-size:12px">Scan for Payments</div>
</div>
<div class="empty-box">
  <div class="empty-title">No Transfers Found</div>
  <p class="empty-body">No stealth transfers matched your keys.<br>Share your meta-address with a sender to receive funds.</p>
  <div style="display:flex;align-items:center;justify-content:space-between;margin-top:12px">
    <span class="label">Your Meta-Address</span>
    <span class="copy-btn">Copy</span>
  </div>
  <div class="meta-addr" style="margin-top:4px">st:xlm:AAAA...BBBB...CCCC...DDDD</div>
</div>
`);
}

module.exports = { sendA, sendB, sendC, receiveA, receiveB, receiveC };
