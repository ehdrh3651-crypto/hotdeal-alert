// 순수 함수 모음: 네트워크와 파일에 접근하지 않으므로 그대로 단위 테스트할 수 있다.

export const LIMITS = Object.freeze({
  maxItemsPerFeed: 100,
  maxTitleLength: 300,
  seenPerSource: 300,
  maxKeywords: 100,
  maxKeywordLength: 60,
  maxPrice: 1_000_000_000,
});

const NAMED_ENTITIES = new Map([
  ['amp', '&'],
  ['lt', '<'],
  ['gt', '>'],
  ['quot', '"'],
  ['apos', "'"],
  ['nbsp', ' '],
]);

/** XML/HTML 엔티티를 한 번만 해석한다. 모르는 엔티티는 그대로 둔다. */
export function decodeEntities(text) {
  return text.replace(/&(#[xX][0-9a-fA-F]{1,6}|#[0-9]{1,7}|[a-zA-Z]{2,8});/g, (whole, body) => {
    if (body[0] === '#') {
      const isHex = body[1] === 'x' || body[1] === 'X';
      const code = isHex ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      const isSurrogate = code >= 0xd800 && code <= 0xdfff;
      if (!Number.isInteger(code) || code <= 0 || code > 0x10ffff || isSurrogate) return whole;
      return String.fromCodePoint(code);
    }
    const value = NAMED_ENTITIES.get(body.toLowerCase());
    return value === undefined ? whole : value;
  });
}

export function isHttpUrl(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2000) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

// tag 인자는 이 파일 안의 고정 문자열만 넘긴다(정규식 삽입 방지).
function extractTag(block, tag) {
  const match = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i'));
  if (!match) return '';
  const inner = match[1].trim();
  const cdata = inner.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
  if (cdata) return cdata[1].trim();
  return decodeEntities(inner).trim();
}

/** RSS 2.0 본문에서 글 목록을 뽑는다. 제목이나 링크가 없는 항목은 버린다. */
export function parseRss(xml) {
  if (typeof xml !== 'string') throw new TypeError('피드 본문이 문자열이 아님');
  const items = [];
  for (const match of xml.matchAll(/<item[\s>][\s\S]*?<\/item>/gi)) {
    if (items.length >= LIMITS.maxItemsPerFeed) break;
    const title = extractTag(match[0], 'title').replace(/\s+/g, ' ').trim();
    const link = extractTag(match[0], 'link');
    if (title.length === 0 || !isHttpUrl(link)) continue;
    items.push({ title: title.slice(0, LIMITS.maxTitleLength), link });
  }
  return items;
}

/** 비교용 정규화: 전각 문자를 반각으로, 소문자로, 공백 제거. */
export function normalize(text) {
  return text.normalize('NFKC').toLowerCase().replace(/\s+/g, '');
}

function toInt(digits) {
  const value = Number(digits.replace(/,/g, ''));
  return Number.isSafeInteger(value) && value >= 0 && value <= LIMITS.maxPrice ? value : null;
}

// 순서가 중요하다: 만원 → 천원 → 원 → 단위 없는 쉼표 숫자.
const AMOUNT_RE =
  /(?<![\d.,])(?:(\d+(?:\.\d+)?)\s*만\s*(?:(\d)\s*천\s*)?원|(\d+)\s*천\s*원|(\d{1,3}(?:,\d{3})+|\d+)\s*원|(\d{1,3}(?:,\d{3})+)(?![\d.,A-Za-z가-힣%]))/g;

// 금액 바로 앞에 오면 판매가가 아닌 표현(할인 한도, 배송비).
const NOT_PRICE_BEFORE = /(?:최대|배송비?|택배비?|배달비?)\s*$/;
// 금액 바로 뒤에 오면 판매가가 아닌 표현(무료배송 조건, 할인액, 적립액).
const NOT_PRICE_AFTER = /^\s*(?:이상|이하|할인|쿠폰|적립|캐시백|페이백|환급|증정)/;

/**
 * 제목에서 원화 판매가를 추정한다.
 * 반환: { price: 정수|null, currency: 'KRW'|'FOREIGN'|null }
 * 여러 금액이 있으면 가장 낮은 값을 고른다(상한 가격 조건에서 알림을 놓치지 않는 방향).
 */
export function extractPrice(title) {
  const text = title.normalize('NFKC');

  // 1순위: 괄호 안의 "가격/배송비" 형식. 단위가 없어도 읽는다. 예: (16900/0)
  // 뒤에 슬래시가 한 번 더 오면 날짜(2026/11/27)로 보고 건너뛴다.
  const slash = text.match(/[(\[]\s*(\d{1,3}(?:,\d{3})+|\d{3,})\s*원?\s*\/(?!\s*\d{1,2}\s*\/)/);
  if (slash) {
    const value = toInt(slash[1]);
    if (value !== null && value > 0) return { price: value, currency: 'KRW' };
  }

  const candidates = [];
  for (const match of text.matchAll(AMOUNT_RE)) {
    let value = null;
    if (match[1] !== undefined) {
      const man = Number(match[1]);
      const cheon = match[2] === undefined ? 0 : Number(match[2]);
      value = Math.round(man * 10000 + cheon * 1000);
    } else if (match[3] !== undefined) {
      value = Number(match[3]) * 1000;
    } else {
      value = toInt(match[4] ?? match[5]);
    }
    if (value === null || !Number.isSafeInteger(value) || value <= 0 || value > LIMITS.maxPrice) continue;

    const before = text.slice(0, match.index);
    const after = text.slice(match.index + match[0].length);
    if (NOT_PRICE_BEFORE.test(before) || NOT_PRICE_AFTER.test(after)) continue;
    // "46,000원/3,000원"의 뒤쪽 금액은 배송비로 본다.
    if (candidates.length > 0 && /\/\s*$/.test(before)) continue;
    candidates.push(value);
  }

  if (candidates.length > 0) return { price: Math.min(...candidates), currency: 'KRW' };
  if (/[$€£¥]\s*\d|\d\s*(?:달러|유로|엔|usd|eur|jpy)/i.test(text)) return { price: null, currency: 'FOREIGN' };
  return { price: null, currency: null };
}

export function formatWon(value) {
  return `${String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}원`;
}

/**
 * 키워드 한 줄을 해석한다. 형식: "포함어 포함어 -제외어 | 상한가격"
 * 반환: 빈 줄·주석이면 null, 아니면 { ok: true, keyword } 또는 { ok: false, reason }
 */
export function parseKeywordLine(line) {
  const trimmed = line.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  if (trimmed.length === 0 || trimmed.startsWith('#')) return null;

  const bar = trimmed.lastIndexOf('|');
  const wordPart = (bar === -1 ? trimmed : trimmed.slice(0, bar)).trim();
  const pricePart = bar === -1 ? '' : trimmed.slice(bar + 1).trim();

  if (wordPart.includes('|')) return { ok: false, reason: "'|' 기호는 가격 구분에 한 번만 쓸 수 있음" };
  if (wordPart.length === 0) return { ok: false, reason: '키워드가 비어 있음' };
  if (wordPart.length > LIMITS.maxKeywordLength) {
    return { ok: false, reason: `키워드는 ${LIMITS.maxKeywordLength}자 이하여야 함` };
  }

  let maxPrice = null;
  if (pricePart.length > 0) {
    if (!/^\d{1,3}(?:,\d{3})*원?$|^\d+원?$/.test(pricePart)) {
      return { ok: false, reason: `가격을 숫자로 적어야 함: "${pricePart}"` };
    }
    const value = toInt(pricePart.replace(/원$/, ''));
    if (value === null) return { ok: false, reason: `가격이 허용 범위를 벗어남: "${pricePart}"` };
    maxPrice = value === 0 ? null : value; // 0은 "가격 조건 없음"으로 취급
  }

  const include = [];
  const exclude = [];
  for (const raw of wordPart.split(/\s+/)) {
    const isExclude = raw.startsWith('-') && raw.length > 1;
    const token = normalize(isExclude ? raw.slice(1) : raw);
    if (token.length === 0) continue;
    const bucket = isExclude ? exclude : include;
    if (!bucket.includes(token)) bucket.push(token);
  }
  if (include.length === 0) return { ok: false, reason: '포함할 단어가 하나 이상 필요함' };

  const words = [...include, ...exclude.map((t) => `-${t}`)].join(' ');
  return {
    ok: true,
    keyword: {
      include,
      exclude,
      maxPrice,
      key: [...include].sort().join(' ') + '|' + [...exclude].sort().join(' '),
      text: maxPrice === null ? words : `${words} | ${maxPrice}`,
      label: maxPrice === null ? words : `${words} (${formatWon(maxPrice)} 이하)`,
    },
  };
}

/** 키워드 파일 전체를 해석한다. 잘못된 줄은 건너뛰고 errors에 모은다. */
export function parseKeywords(fileText) {
  const keywords = [];
  const errors = [];
  const lines = fileText.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const parsed = parseKeywordLine(lines[i]);
    if (parsed === null) continue;
    if (!parsed.ok) {
      errors.push(`${i + 1}번째 줄: ${parsed.reason}`);
      continue;
    }
    if (keywords.length >= LIMITS.maxKeywords) {
      errors.push(`${i + 1}번째 줄: 키워드는 ${LIMITS.maxKeywords}개까지만 사용함`);
      break;
    }
    keywords.push(parsed.keyword);
  }
  return { keywords, errors };
}

export function matchKeyword(normalizedTitle, keyword) {
  return (
    keyword.include.every((token) => normalizedTitle.includes(token)) &&
    !keyword.exclude.some((token) => normalizedTitle.includes(token))
  );
}

/**
 * 제목 하나를 키워드 전체와 대조한다.
 * 가격을 읽지 못한 글은 가격 조건이 있어도 알림 대상에 넣는다(놓치는 것보다 낫다).
 */
export function evaluate(title, keywords) {
  const normalizedTitle = normalize(title);
  const { price, currency } = extractPrice(title);
  const hits = keywords.filter(
    (keyword) =>
      matchKeyword(normalizedTitle, keyword) &&
      (keyword.maxPrice === null || price === null || price <= keyword.maxPrice),
  );
  return { hits, price, currency };
}

/**
 * 키워드 파일에 추가·삭제·목록 동작을 적용한다.
 * 반환: { text: 새 파일 내용, changed: 변경 여부, ok: 성공 여부, message: 사용자에게 보낼 결과 }
 */
export function applyKeywordAction(fileText, action, keywordInput, priceInput) {
  const lines = fileText.split(/\r?\n/);
  const entries = [];
  lines.forEach((line, index) => {
    const parsed = parseKeywordLine(line);
    if (parsed !== null && parsed.ok) entries.push({ index, keyword: parsed.keyword });
  });
  const listing = (items) =>
    items.length === 0 ? '(등록된 키워드 없음)' : items.map((k) => `• ${k.label}`).join('\n');
  const current = entries.map((entry) => entry.keyword);
  const unchanged = (ok, message) => ({ text: fileText, changed: false, ok, message });

  if (action === 'list') return unchanged(true, `키워드 ${current.length}개\n${listing(current)}`);
  if (action !== 'add' && action !== 'remove') return unchanged(false, `알 수 없는 동작: ${action}`);

  const word = String(keywordInput ?? '').replace(/[\u0000-\u001f\u007f|]/g, ' ').trim();
  const price = String(priceInput ?? '').trim();
  if (word.startsWith('#')) return unchanged(false, "키워드는 '#'으로 시작할 수 없음");
  const parsed = parseKeywordLine(action === 'add' && price.length > 0 ? `${word} | ${price}` : word);
  if (parsed === null) return unchanged(false, '키워드가 비어 있음');
  if (!parsed.ok) return unchanged(false, parsed.reason);
  const target = parsed.keyword;
  const existing = entries.find((entry) => entry.keyword.key === target.key);

  if (action === 'remove') {
    if (!existing) return unchanged(false, `없는 키워드: ${target.label}\n\n현재 목록\n${listing(current)}`);
    lines.splice(existing.index, 1);
    const rest = current.filter((k) => k.key !== target.key);
    return {
      text: lines.join('\n'),
      changed: true,
      ok: true,
      message: `삭제함: ${existing.keyword.label}\n\n현재 ${rest.length}개\n${listing(rest)}`,
    };
  }

  if (existing) {
    // 단어 순서만 다른 입력은 같은 키워드다. 가격 조건이 같으면 파일을 건드리지 않는다.
    if (existing.keyword.maxPrice === target.maxPrice) {
      return unchanged(true, `이미 등록됨: ${existing.keyword.label}`);
    }
    lines[existing.index] = target.text;
    const next = current.map((k) => (k.key === target.key ? target : k));
    return {
      text: lines.join('\n'),
      changed: true,
      ok: true,
      message: `가격 조건을 바꿈: ${target.label}\n\n현재 ${next.length}개\n${listing(next)}`,
    };
  }
  if (current.length >= LIMITS.maxKeywords) {
    return unchanged(false, `키워드는 ${LIMITS.maxKeywords}개까지 등록할 수 있음`);
  }
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();
  lines.push(target.text, '');
  const next = [...current, target];
  return {
    text: lines.join('\n'),
    changed: true,
    ok: true,
    message: `추가함: ${target.label}\n\n현재 ${next.length}개\n${listing(next)}`,
  };
}

const COUNTERS = ['runs', 'checked', 'alerted', 'errors', 'gaps'];

export function emptyStats(day) {
  return { day, runs: 0, checked: 0, alerted: 0, errors: 0, gaps: 0 };
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * 저장된 상태를 검증해 안전한 형태로 만든다.
 * 알려진 출처 ID만 복사하므로 손상되거나 조작된 파일의 임의 키는 버려진다.
 */
export function sanitizeState(raw, sourceIds) {
  const state = { version: 1, seen: {}, fails: {}, stats: emptyStats('') };
  if (!isPlainObject(raw)) return state;
  for (const id of sourceIds) {
    if (isPlainObject(raw.seen) && Object.hasOwn(raw.seen, id) && Array.isArray(raw.seen[id])) {
      state.seen[id] = raw.seen[id].filter((x) => typeof x === 'string').slice(-LIMITS.seenPerSource);
    }
    if (isPlainObject(raw.fails) && Object.hasOwn(raw.fails, id)) {
      const count = raw.fails[id];
      if (Number.isSafeInteger(count) && count >= 0) state.fails[id] = count;
    }
  }
  if (isPlainObject(raw.stats)) {
    if (typeof raw.stats.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.stats.day)) {
      state.stats.day = raw.stats.day;
    }
    for (const name of COUNTERS) {
      const value = raw.stats[name];
      if (Number.isSafeInteger(value) && value >= 0) state.stats[name] = value;
    }
  }
  return state;
}

/** 요약 구간의 키. UTC 날짜가 바뀌는 시점이 한국 시간 오전 9시다. */
export function summaryDay(date) {
  return date.toISOString().slice(0, 10);
}
