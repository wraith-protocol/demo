export const SECRET_PATTERNS = Object.freeze([
  {
    id: 'canary',
    label: 'seeded canary secret',
    regex: /\b(?:WRAITH[_-]?CANARY|CANARY)[_-][A-Z0-9][A-Z0-9_-]{5,}\b/gi,
  },
  {
    id: 'pem-private-key',
    label: 'PEM private key',
    regex:
      /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z ]+ )?PRIVATE KEY-----/g,
  },
  {
    id: 'jwt',
    label: 'JSON web token',
    regex: /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\b/g,
  },
  {
    id: 'url-credentials',
    label: 'credentials embedded in URL',
    regex: /\b[a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:[^/\s@]+@/gi,
  },
  {
    id: 'credential-query',
    label: 'credential in URL query string',
    regex: /[?&](?:api[_-]?key|apikey|token|secret|password|passphrase|key)=[^&#\s"']+/gi,
  },
  {
    id: 'stellar-secret-seed',
    label: 'Stellar secret seed',
    regex: /\bS[2-7A-Z]{55}\b/g,
  },
  {
    id: 'labeled-hex-secret',
    label: 'private key or scalar',
    regex:
      /\b(?:private[_-]?key|private[_-]?scalar|spending[_-]?(?:key|scalar)|viewing[_-]?(?:key|scalar)|secret[_-]?(?:key|scalar|seed)|seed|mnemonic)\b["']?\s*(?:[:=]|\s)\s*["']?(?:0x)?[0-9a-fA-F]{64}\b/gi,
  },
  {
    id: 'labeled-base58-secret',
    label: 'Solana secret key',
    regex:
      /\b(?:secret[_-]?key|private[_-]?key|solana[_-]?secret)\b["']?\s*(?:[:=]|\s)\s*["']?[1-9A-HJ-NP-Za-km-z]{64,88}\b/gi,
  },
  {
    id: 'kdf-salt',
    label: 'KDF salt',
    regex:
      /\b(?:salt|kdf[_-]?salt)\b["']?\s*(?:[:=]|\s)\s*["']?(?:0x)?(?:[0-9a-fA-F]{32,}|[A-Za-z0-9+/]{24,}={0,2})/gi,
  },
  {
    id: 'signature-material',
    label: 'signature material',
    regex:
      /\b(?:signature|signed[_-]?xdr|authorization)\b["']?\s*(?:[:=]|\s)\s*["']?(?:0x)?[0-9a-fA-F]{100,}|\b0x[0-9a-fA-F]{100,}\b|AAAA[A-Za-z0-9+/=]{80,}/gi,
  },
  {
    id: 'secret-assignment',
    label: 'secret assignment',
    regex:
      /\b(?:api[_-]?key|auth[_-]?token|access[_-]?token|password|passphrase|bearer)\b["']?\s*[:=]\s*["']?([^\s"',;}\]]{6,})/gi,
  },
]);

export const PUBLIC_VALUE_PATTERNS = Object.freeze({
  evmTxHash: /\b0x[0-9a-fA-F]{64}\b/g,
  evmAddress: /\b0x[0-9a-fA-F]{40}\b/g,
  stellarPublicKey: /\bG[2-7A-Z]{55}\b/g,
  stellarTxHash: /\b[0-9A-F]{64}\b/g,
  solanaPublicKey: /\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g,
});

export function toText(input) {
  if (typeof input === 'string') return input;
  if (input instanceof Error) {
    return `${input.name}: ${input.message}\n${input.stack ?? ''}`;
  }
  if (Array.isArray(input)) {
    return input.map(toText).join(' ');
  }
  if (input && typeof input === 'object') {
    const seen = new WeakSet();
    return JSON.stringify(input, (_key, value) => {
      if (value && typeof value === 'object') {
        if (seen.has(value)) return '[circular]';
        seen.add(value);
      }
      return value;
    });
  }
  return String(input);
}

export function maskSecret(value) {
  const text = String(value);
  if (text.length <= 8) return '*'.repeat(text.length);
  return `${text.slice(0, 3)}…${text.slice(-2)}`;
}

export function findSecrets(input) {
  const text = toText(input);
  const findings = [];
  for (const pattern of SECRET_PATTERNS) {
    pattern.regex.lastIndex = 0;
    let match;
    while ((match = pattern.regex.exec(text)) !== null) {
      findings.push({
        id: pattern.id,
        label: pattern.label,
        index: match.index,
        length: match[0].length,
        value: match[0],
        preview: maskSecret(match[0]),
      });
      if (match[0].length === 0) pattern.regex.lastIndex += 1;
    }
  }
  return findings.sort((a, b) => a.index - b.index || b.length - a.length);
}

export function redactSecrets(input) {
  const text = toText(input);
  let output = '';
  let cursor = 0;
  for (const finding of findSecrets(text)) {
    if (finding.index < cursor) continue;
    output += `${text.slice(cursor, finding.index)}[REDACTED:${finding.id}]`;
    cursor = finding.index + finding.length;
  }
  return output + text.slice(cursor);
}

export function redactValue(value, seen = new WeakSet(), depth = 0) {
  if (typeof value === 'string') return redactSecrets(value);
  if (value instanceof Error) {
    const copy = new Error(redactSecrets(value.message));
    copy.name = value.name;
    copy.stack = redactSecrets(value.stack ?? '');
    return copy;
  }
  if (value === null || typeof value !== 'object') return value;
  if (depth > 8 || seen.has(value)) return '[REDACTED:circular]';
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => redactValue(item, seen, depth + 1));
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    result[key] = redactValue(item, seen, depth + 1);
  }
  return result;
}

export function hasSecrets(input) {
  return findSecrets(input).length > 0;
}

export function isCanary(input) {
  return findSecrets(input).some((finding) => finding.id === 'canary');
}
