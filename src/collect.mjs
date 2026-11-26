// 수집기: 출처(src/sources.mjs)의 RSS와 목록 화면을 읽어 새 글을 키워드와 대조하고 ntfy로 알린다.
// 환경 변수: NTFY_TOPIC(필수), STATE_FILE, KEYWORDS_FILE, NTFY_SERVER, HEALTHCHECK_URL
// DRY_RUN=1이면 알림과 외부 감시 신호를 보내지 않고 화면에만 출력한다(상태 파일은 그대로 기록).
import { readFile, writeFile, rename } from 'node:fs/promises';
import { LIMITS, parseKeywords, evaluate, formatWon, sanitizeState, emptyStats, summaryDay } from './lib.mjs';
import { isValidTopic, resolveServer, sendNtfy } from './ntfy.mjs';
import { SOURCES } from './sources.mjs';

const USER_AGENT = 'hotdeal-keyword-alert/1.0 (personal RSS reader)';
const FETCH_TIMEOUT_MS = 15_000;
const MAX_FEED_BYTES = 2 * 1024 * 1024;
const MAX_ALERTS_PER_RUN = 10; // 키워드가 너무 넓을 때 ntfy 하루 한도(250건)를 지키기 위한 상한
const FAIL_ALERT_AT = 3; // 같은 출처가 연속으로 이만큼 실패하면 알림
const FAIL_REPEAT_EVERY = 100; // 그 뒤로는 이 횟수마다 다시 알림

async function fetchFeed(url, accept) {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: accept },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  if (res.body === null) throw new Error('응답 본문 없음');

  // 본문을 한도까지만 읽는다(비정상적으로 큰 응답 방어).
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_FEED_BYTES) {
      await reader.cancel();
      throw new Error('피드 크기가 한도를 넘음');
    }
    chunks.push(value);
  }
  const bytes = Buffer.concat(chunks);

  // XML 선언의 인코딩을 따르고, 모르는 인코딩이면 UTF-8로 읽는다.
  const declared = bytes.subarray(0, 200).toString('latin1').match(/encoding\s*=\s*["']([A-Za-z0-9._-]+)["']/);
  let decoder;
  try {
    decoder = new TextDecoder(declared ? declared[1] : 'utf-8');
  } catch {
    decoder = new TextDecoder('utf-8');
  }
  return decoder.decode(bytes);
}

async function readJsonOrNull(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return null; // 파일이 없거나 손상됨 → 빈 상태에서 다시 시작
  }
}

async function writeFileAtomic(path, text) {
  const temp = `${path}.tmp`;
  await writeFile(temp, text, 'utf8');
  await rename(temp, path);
}

function priceLine(price, currency) {
  if (price !== null) return `가격: ${formatWon(price)}`;
  if (currency === 'FOREIGN') return '가격: 외화 표기라 비교하지 못함';
  return '가격: 미확인 (제목에서 읽지 못함)';
}

async function main() {
  const dryRun = process.env.DRY_RUN === '1';
  const topic = (process.env.NTFY_TOPIC ?? '').trim();
  const server = resolveServer(process.env.NTFY_SERVER);
  const stateFile = process.env.STATE_FILE || 'state.json';
  const keywordsFile = process.env.KEYWORDS_FILE || 'keywords.txt';

  if (!dryRun && !isValidTopic(topic)) {
    console.error('설정 오류: NTFY_TOPIC 시크릿이 없거나 형식이 맞지 않음(영문·숫자·-·_ 16~64자).');
    process.exitCode = 1;
    return;
  }
  if (server === null) {
    console.error('설정 오류: NTFY_SERVER는 https 주소여야 함.');
    process.exitCode = 1;
    return;
  }
  const notify = (fields) => sendNtfy({ server, topic, dryRun, ...fields });

  const state = sanitizeState(await readJsonOrNull(stateFile), SOURCES.map((s) => s.id));
  const { keywords, errors: keywordErrors } = parseKeywords(await readFile(keywordsFile, 'utf8'));
  for (const message of keywordErrors) console.warn(`키워드 파일 경고 - ${message}`);
  console.log(`키워드 ${keywords.length}개`);

  // 하루 요약: 한국 시간 오전 9시 이후 첫 실행에서 직전 24시간 통계를 보낸다.
  const today = summaryDay(new Date());
  if (state.stats.day !== today) {
    if (state.stats.day !== '') {
      const s = state.stats;
      const lines = [`확인한 글 ${s.checked}건, 알림 ${s.alerted}건`, `실행 ${s.runs}회, 오류 ${s.errors}회`];
      if (s.gaps > 0) lines.push(`글이 몰려 일부를 못 봤을 수 있는 구간 ${s.gaps}회`);
      if (keywords.length === 0) lines.push('등록된 키워드가 없음');
      const sent = await notify({ title: '핫딜 알림 하루 요약', message: lines.join('\n'), priority: 2 });
      if (!sent) console.error('하루 요약 전송 실패');
    }
    state.stats = emptyStats(today);
  }
  state.stats.runs += 1;

  let alertsSent = 0;
  let deferred = 0;
  let sendFailures = 0;
  let sourcesOk = 0;

  for (const source of SOURCES) {
    let items;
    try {
      items = source.parse(await fetchFeed(source.url, source.accept));
      if (items.length === 0) throw new Error('글 0건 (형식이 바뀌었거나 차단됐을 수 있음)');
    } catch (error) {
      const reason = error?.name === 'TimeoutError' ? '응답 시간 초과' : String(error?.message ?? error);
      const fails = (state.fails[source.id] ?? 0) + 1;
      state.fails[source.id] = fails;
      state.stats.errors += 1;
      console.error(`${source.name} 수집 실패(연속 ${fails}회): ${reason}`);
      if (fails === FAIL_ALERT_AT || fails % FAIL_REPEAT_EVERY === 0) {
        await notify({
          title: `${source.name} 수집이 연속 ${fails}회 실패`,
          message: `원인: ${reason}\n이 출처의 딜 알림이 멈춘 상태입니다.`,
          priority: 4,
          tags: ['warning'],
        });
      }
      continue;
    }

    if ((state.fails[source.id] ?? 0) >= FAIL_ALERT_AT) {
      await notify({ title: `${source.name} 수집 복구`, message: '다시 정상적으로 읽고 있습니다.', priority: 2 });
    }
    state.fails[source.id] = 0;
    sourcesOk += 1;

    const isBaseline = !Object.hasOwn(state.seen, source.id);
    const seenList = isBaseline ? [] : state.seen[source.id];
    const seenSet = new Set(seenList);
    const fresh = items.filter((item) => !seenSet.has(item.link));
    // 받은 글이 전부 처음 보는 글이면, 지난 실행과 이번 실행 사이에 밀려난 글이 있을 수 있다.
    if (!isBaseline && seenList.length > 0 && fresh.length === items.length) state.stats.gaps += 1;

    // 피드는 최신순이므로 뒤집어 오래된 글부터 처리한다.
    for (const item of fresh.reverse()) {
      if (isBaseline) {
        seenList.push(item.link); // 첫 실행은 기준선만 기록하고 알리지 않는다.
        continue;
      }
      const result = evaluate(item.title, keywords);
      if (result.hits.length === 0) {
        seenList.push(item.link);
        state.stats.checked += 1;
        continue;
      }
      if (alertsSent >= MAX_ALERTS_PER_RUN) {
        deferred += 1; // 기록하지 않고 남겨 두어 다음 실행에서 다시 시도한다.
        continue;
      }
      const sent = await notify({
        title: `[${source.name}] ${item.title}`,
        message: `키워드: ${result.hits.map((k) => k.label).join(', ')}\n${priceLine(result.price, result.currency)}`,
        click: item.link,
      });
      if (sent) {
        seenList.push(item.link);
        state.stats.checked += 1;
        state.stats.alerted += 1;
        alertsSent += 1;
        console.log(`알림: [${source.name}] ${item.title}`);
      } else {
        sendFailures += 1; // 기록하지 않아 다음 실행에서 다시 보낸다.
        state.stats.errors += 1;
      }
    }
    state.seen[source.id] = seenList.slice(-LIMITS.seenPerSource);
    console.log(`${source.name}: 글 ${items.length}건 중 새 글 ${fresh.length}건${isBaseline ? ' (첫 실행, 기준선 기록)' : ''}`);
  }

  if (deferred > 0) console.warn(`알림 상한(${MAX_ALERTS_PER_RUN}건)을 넘어 ${deferred}건을 다음 실행으로 미룸`);
  await writeFileAtomic(stateFile, JSON.stringify(state));

  // 외부 감시(선택): 모든 출처를 읽고 알림 전송도 성공한 실행만 정상 신호를 보낸다.
  const healthUrl = (process.env.HEALTHCHECK_URL ?? '').trim();
  if (!dryRun && healthUrl.startsWith('https://') && sourcesOk === SOURCES.length && sendFailures === 0) {
    try {
      await fetch(healthUrl, { signal: AbortSignal.timeout(10_000) });
    } catch {
      console.error('외부 감시 신호 전송 실패');
    }
  }
  console.log(`완료: 알림 ${alertsSent}건, 전송 실패 ${sendFailures}건, 정상 출처 ${sourcesOk}/${SOURCES.length}`);
}

await main();
