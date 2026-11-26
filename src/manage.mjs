// 키워드 관리. 두 단계로 나눠 실행한다.
//   node src/manage.mjs apply   → keywords.txt를 고치고 결과를 RESULT_FILE에 적는다
//   node src/manage.mjs notify  → 저장이 끝난 뒤 RESULT_FILE의 결과를 ntfy로 보낸다
// 환경 변수: ACTION(add|remove|list), KEYWORD, PRICE, RESULT_FILE, KEYWORDS_FILE, NTFY_TOPIC, DRY_RUN=1
import { readFile, writeFile } from 'node:fs/promises';
import { applyKeywordAction } from './lib.mjs';
import { isValidTopic, resolveServer, sendNtfy } from './ntfy.mjs';

const keywordsFile = process.env.KEYWORDS_FILE || 'keywords.txt';
const resultFile = process.env.RESULT_FILE || 'keyword-result.json';
const mode = process.argv[2];

if (mode === 'apply') {
  const action = (process.env.ACTION ?? '').trim();
  const before = await readFile(keywordsFile, 'utf8');
  const result = applyKeywordAction(before, action, process.env.KEYWORD ?? '', process.env.PRICE ?? '');
  if (result.changed) await writeFile(keywordsFile, result.text, 'utf8');
  await writeFile(resultFile, JSON.stringify({ ok: result.ok, message: result.message }), 'utf8');
  console.log(result.ok ? '처리함' : '처리하지 못함');
  console.log(result.message);
} else if (mode === 'notify') {
  const dryRun = process.env.DRY_RUN === '1';
  const topic = (process.env.NTFY_TOPIC ?? '').trim();
  const server = resolveServer(process.env.NTFY_SERVER);
  if ((!dryRun && !isValidTopic(topic)) || server === null) {
    console.error('설정 오류: NTFY_TOPIC 또는 NTFY_SERVER가 올바르지 않음.');
    process.exitCode = 1;
  } else {
    const result = JSON.parse(await readFile(resultFile, 'utf8'));
    const sent = await sendNtfy({
      server,
      topic,
      dryRun,
      title: result.ok === true ? '키워드 처리 완료' : '키워드 처리 실패',
      message: String(result.message ?? ''),
      priority: result.ok === true ? 3 : 4,
    });
    if (!sent) process.exitCode = 1;
  }
} else {
  console.error('사용법: node src/manage.mjs apply|notify');
  process.exitCode = 1;
}
