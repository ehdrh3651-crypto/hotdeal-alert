// ntfy 알림 전송. 토픽명은 요청 본문에만 넣어 주소와 로그에 남지 않게 한다.
import { isHttpUrl } from './lib.mjs';

const SEND_TIMEOUT_MS = 10_000;
const MAX_TITLE_CHARS = 200;
const MAX_MESSAGE_BYTES = 3500; // ntfy 메시지 한도 4,096바이트보다 여유 있게

/** 토픽명은 사실상 비밀번호이므로 짧은 이름은 거부한다. */
export function isValidTopic(topic) {
  return typeof topic === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(topic);
}

export function resolveServer(value) {
  const server = (value ?? '').trim() || 'https://ntfy.sh/';
  try {
    const url = new URL(server);
    if (url.protocol !== 'https:') return null;
    return url.origin + '/';
  } catch {
    return null;
  }
}

export function truncateBytes(text, maxBytes) {
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) return text;
  let out = '';
  let used = 0;
  for (const ch of text) {
    const size = Buffer.byteLength(ch, 'utf8');
    if (used + size > maxBytes - 3) break;
    out += ch;
    used += size;
  }
  return out + '…';
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 알림 1건을 보낸다. 성공하면 true. 일시 오류(429, 5xx, 네트워크)는 한 번 재시도한다. */
export async function sendNtfy({ server, topic, title, message, click, priority, tags, dryRun }) {
  const body = {
    topic,
    title: [...String(title)].slice(0, MAX_TITLE_CHARS).join(''),
    message: truncateBytes(String(message), MAX_MESSAGE_BYTES),
  };
  if (isHttpUrl(click)) body.click = click;
  if (Number.isInteger(priority) && priority >= 1 && priority <= 5) body.priority = priority;
  if (Array.isArray(tags) && tags.length > 0) body.tags = tags;

  if (dryRun) {
    console.log('[DRY_RUN 알림]', JSON.stringify({ ...body, topic: '(숨김)' }, null, 1));
    return true;
  }

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch(server, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      });
      if (res.ok) return true;
      console.error(`ntfy 응답 코드 ${res.status}`);
      if (res.status !== 429 && res.status < 500) return false;
    } catch (error) {
      console.error(`ntfy 전송 오류: ${error?.name ?? 'Error'}`);
    }
    if (attempt < 2) await sleep(2000);
  }
  return false;
}
