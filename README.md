# 핫딜 키워드 알림

여러 커뮤니티의 핫딜 게시판을 5분마다 읽고, 등록한 키워드(와 가격 조건)에 맞는 새 글이 올라오면 아이폰으로 푸시 알림을 보낸다.

- 실행: GitHub Actions (PC를 켜 둘 필요 없음)
- 알림: ntfy 앱
- 키워드 추가·삭제: 아이폰 단축어

## 알림이 오는 출처

| 출처 | 게시판 | 읽는 방식 |
|---|---|---|
| 뽐뿌 | 뽐뿌게시판, 해외뽐뿌 | RSS |
| 루리웹 | 핫딜/예판 | RSS |
| 어미새 | 기타정보 | RSS |
| 클리앙 | 알뜰구매 | 목록 화면 |
| 딜바다 | 국내핫딜, 해외핫딜 | 목록 화면 |

아래 사이트는 넣지 않았다(2026-11-27 확인).

| 사이트 | 넣지 않은 이유 |
|---|---|
| 펨코 핫딜 | robots.txt가 `/hotdeal` 경로의 자동 수집을 금지함 |
| 쿨엔조이 지름/알뜰정보 | robots.txt가 구글·네이버 외 모든 수집기를 전체 금지함 (RSS 주소 자체는 열려 있음) |
| 퀘이사존 지름/할인정보 | robots.txt와 게시판 모두 403으로 접근을 거부함 |
| 어미새 패션정보 | RSS가 비어 있음 |

목록 화면을 읽는 출처는 사이트가 화면 구성을 바꾸면 글을 못 읽게 된다. 그때는 "연속 3회 실패" 알림이 온다.

## 설정 순서

### 1. ntfy 토픽명 만들기

토픽명은 비밀번호와 같다. 이름을 아는 사람은 누구나 알림을 받아 보거나 보낼 수 있으므로 무작위 문자열을 쓴다. PC의 PowerShell에서 아래 명령을 실행하면 하나 만들어진다.

```powershell
$b = New-Object byte[] 16; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); 'hotdeal-' + (($b | ForEach-Object { $_.ToString('x2') }) -join '')
```

나온 값(`hotdeal-`로 시작하는 40자)을 메모해 둔다. 2단계와 4단계에서 쓴다.

### 2. 아이폰에 ntfy 앱 설치

1. App Store에서 **ntfy**를 설치하고 알림을 허용한다.
2. 앱에서 `+`를 눌러 1단계의 토픽명을 그대로 입력해 구독한다. 서버는 기본값(ntfy.sh)을 쓴다.

### 3. GitHub 저장소 만들고 파일 올리기

1. GitHub 오른쪽 위 `+` → **New repository**.
2. 이름을 정하고(예: `hotdeal-alert`) **Public**을 고른다. "Add a README file"은 체크하지 않는다.
3. 만들어진 빈 저장소 화면에서 **uploading an existing file** 링크를 누른다.
4. 이 폴더(`hotdeal-alert`) 안의 `.github`, `src`, `test`, `keywords.txt`, `README.md`를 모두 끌어다 놓고 **Commit changes**를 누른다.

올린 뒤 저장소에 `.github/workflows/collect.yml`과 `keywords.yml`이 보이는지 확인한다. `.github` 폴더가 빠졌다면 **Add file → Create new file**에서 파일 이름에 `.github/workflows/collect.yml`처럼 경로째 입력하고 내용을 붙여 넣는다.

공개 저장소이므로 키워드 목록과 실행 기록은 누구나 볼 수 있다. 토픽명은 다음 단계의 시크릿에만 넣으므로 공개되지 않는다.

### 4. 토픽명을 시크릿으로 등록

저장소 **Settings → Secrets and variables → Actions → New repository secret**

- Name: `NTFY_TOPIC`
- Secret: 1단계의 토픽명

### 5. 동작 확인

1. 저장소 **Actions** 탭 → 왼쪽 **keywords** → **Run workflow** → action을 `list`로 두고 실행한다.
2. 1분 안에 아이폰에 "키워드 처리 완료" 알림이 오면 알림 경로는 정상이다.
3. 왼쪽 **collect** → **Run workflow**를 한 번 실행한다. 첫 실행은 지금 올라와 있는 글을 "이미 본 글"로 기록만 하고 알림은 보내지 않는다.

이후에는 5분마다 자동으로 실행된다.

### 6. 단축어용 토큰 발급

GitHub 오른쪽 위 프로필 → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**

- Repository access: **Only select repositories** → 이 저장소 하나만 선택
- Permissions → Repository permissions → **Actions: Read and write**
- 나머지 권한은 건드리지 않는다.

발급된 토큰은 한 번만 보이므로 바로 7단계에 붙여 넣는다. 만료일이 지나면 단축어가 동작하지 않으므로 그때 새로 발급해 단축어에 다시 넣는다.

### 7. 아이폰 단축어 만들기

단축어 앱에서 `+`로 새 단축어를 만들고 동작을 아래 순서로 추가한다. 동작 이름은 iOS 버전에 따라 조금 다를 수 있다.

**핫딜 키워드 추가**

1. **입력 요청**: 유형 텍스트, 질문 "키워드"
2. **입력 요청**: 유형 숫자, 질문 "상한 가격 (없으면 0)"
3. **URL의 콘텐츠 가져오기**
   - URL: `https://api.github.com/repos/사용자명/저장소명/actions/workflows/keywords.yml/dispatches`
   - 방법: POST
   - 헤더: `Authorization` = `Bearer 토큰` (Bearer 뒤에 한 칸 띄우고 6단계의 토큰), `Accept` = `application/vnd.github+json`
   - 본문 요청: JSON
     - `ref` (텍스트) = `main`
     - `inputs` (사전)
       - `action` (텍스트) = `add`
       - `keyword` (텍스트) = 1번 입력값
       - `price` (텍스트) = 2번 입력값

공유 시트의 "홈 화면에 추가"로 아이콘을 만들어 두면 편하다.

**삭제와 목록**: 위 단축어를 복제해서 고친다.

- 삭제: `action`을 `remove`로 바꾸고 가격 입력과 `price`를 지운다.
- 목록: `action`을 `list`로 바꾸고 입력 요청 두 개와 `keyword`, `price`를 지운다.

단축어를 실행하면 화면에는 아무 표시가 없고, 보통 1분 안에 ntfy 알림으로 결과가 온다. 추가한 키워드는 다음 수집부터 적용된다.

### 8. (선택) 수집기 멈춤 감시

수집기 자체가 멈추면 스스로 알릴 수 없다. Healthchecks.io 같은 감시 서비스에서 신호 주소를 받아 `HEALTHCHECK_URL` 시크릿으로 등록하면, 정상 실행 때마다 신호를 보낸다. 감시 서비스 쪽에서 "1시간 동안 신호가 없으면 알림"으로 설정한다. 무료 요금제 조건은 해당 서비스의 공식 사이트에서 확인한다.

이 설정을 하지 않아도 아래 두 가지는 기본으로 동작한다.

- 한 출처가 연속 3회 실패하면 경고 알림, 복구되면 복구 알림
- 매일 한국 시간 오전 9시 이후 첫 실행에서 하루 요약 알림 (요약이 안 오면 수집기가 멈춘 것)

## 키워드 형식

| 입력 | 의미 |
|---|---|
| `에어팟 프로` | 제목에 "에어팟"과 "프로"가 모두 있으면 알림 |
| `에어팟 프로` + 가격 250000 | 위 조건에 더해 250,000원 이하일 때만 |
| `에어팟 -케이스` | "케이스"가 들어간 글은 제외 |

띄어쓰기와 영문 대소문자는 구분하지 않는다. 같은 키워드를 다른 가격으로 다시 추가하면 가격 조건만 바뀐다. GitHub에서 `keywords.txt`를 직접 고쳐도 된다.

## 알아 둘 한계

- **가격은 제목에서 추정한다.** 가격을 읽지 못한 글과 외화로 적힌 글은 가격 조건이 있어도 "가격 미확인"으로 알림을 보낸다. 묶음 상품의 개당 가격, 카드·쿠폰 적용가는 구분하지 못한다.
- **5분보다 빠를 수 없고 늦어질 수 있다.** GitHub이 혼잡하면 실행이 밀리거나 드물게 건너뛴다.
- **글이 몰리면 놓칠 수 있다.** 각 출처는 최신 글 15~30건만 보여 준다. 실행 간격 사이에 그보다 많이 올라오면 일부를 못 본다. 그런 구간이 있었는지는 하루 요약에 표시된다.
- **같은 딜이 여러 게시판에 올라오면 알림이 게시판 수만큼 온다.**
- **해외 게시판은 가격 조건이 거의 적용되지 않는다.** 달러로 적힌 글은 원화 상한과 비교할 수 없어서, 키워드만 맞으면 "가격 미확인"이나 "외화 표기"로 알림이 온다.
- **GitHub 서버에서는 막히는 출처가 있을 수 있다.** 모든 출처는 집 PC에서 읽히는 것을 확인했지만, GitHub 서버의 주소를 차단하는 사이트는 "연속 3회 실패" 알림이 온다. 그 출처는 `src/sources.mjs`에서 지운다.
- **한 번 실행에 알림은 최대 10건이다.** 넘는 글은 다음 실행에서 보낸다.
- **60일 동안 저장소 활동이 없으면 GitHub이 스케줄을 끈다.** Actions 탭에서 다시 켤 수 있다. 수집기가 state 브랜치에 기록을 남기는 것이 활동으로 인정되는지는 확인하지 못했다.

## 확인한 수치와 출처 (2026-11-26 조회)

| 항목 | 값 | 출처 |
|---|---|---|
| 스케줄 최소 간격 | 5분 | GitHub Docs, Events that trigger workflows |
| 스케줄 자동 중지 | 공개 저장소에서 60일간 활동이 없을 때 | 위와 같음 |
| 공개 저장소 실행 요금 | 표준 러너는 무료 | GitHub Docs, GitHub Actions billing |
| 워크플로 호출에 필요한 토큰 권한 | Actions 쓰기 | GitHub Docs, REST API endpoints for workflows |
| ntfy.sh 하루 메시지 한도 | 250건 | ntfy 문서, Publishing |
| ntfy 메시지 크기 한도 | 4,096바이트 | 위와 같음 |

## 파일 구성

| 파일 | 역할 |
|---|---|
| `keywords.txt` | 키워드 목록 |
| `src/collect.mjs` | 수집기 (출처 읽기, 키워드 대조, 알림) |
| `src/sources.mjs` | 출처 목록과 출처별 읽는 방법 |
| `src/manage.mjs` | 키워드 추가·삭제·목록 |
| `src/lib.mjs` | RSS 해석, 가격 추정, 키워드 해석 |
| `src/ntfy.mjs` | ntfy 전송 |
| `.github/workflows/collect.yml` | 5분마다 수집기 실행 |
| `.github/workflows/keywords.yml` | 단축어가 호출하는 키워드 관리 |
| `test/lib.test.mjs` | 단위 테스트 (`node --test test/`) |

본 글 기록과 통계는 저장소의 `state` 브랜치에 있는 `state.json`에 저장된다.

## 출처를 바꾸려면

`src/sources.mjs` 맨 아래의 `SOURCES` 목록에서 줄을 지우거나 추가한다. 추가하기 전에 그 사이트의 robots.txt와 이용 약관이 자동 수집을 허용하는지 확인한다. aagag.com의 `/deal`은 robots.txt에서 수집을 금지하고 있어 쓰지 않는다.

새로 넣은 출처는 첫 실행에서 지금 올라와 있는 글을 기록만 하고, 그 뒤에 올라오는 글부터 알린다.

## 고친 파일을 GitHub에 반영하려면

저장소 화면에서 **Add file → Upload files**를 누르고, 바뀐 파일이 든 폴더(`src`, `test`)와 `README.md`를 끌어다 놓은 뒤 **Commit changes**를 누른다. 같은 이름의 파일은 새 내용으로 바뀐다.

`keywords.txt`는 올리지 않는다. 올리면 단축어로 등록해 둔 키워드가 PC에 있는 빈 파일로 덮어써진다.
