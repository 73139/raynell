# 러스트라인 웹 개발 소스

저장소 루트에서 다음 명령을 실행하면 모듈 소스, 게임 데이터, 원본 WebP와 회귀 테스트가 `dev/`에 풀립니다. 기존 작업이 있다면 먼저 커밋하세요.

```sh
python3 -m zipfile -e development/Rustline-source.zip .
cd dev
python3 build.py
set -e
for test in tests/*.cjs; do
  [ "$test" = tests/game-fixture.cjs ] || node "$test"
done
cp index.html ../rustline-web/index.html
python3 pack_source.py
```

빌드는 Python 3 표준 라이브러리를 사용합니다. 테스트는 Node.js 24에서 실행합니다. 브라우저 검증에는 Python Playwright와 Chromium이 필요합니다. 예를 들어 `python3 tests/ward-trial-browser.py 390 1280`으로 모바일과 데스크톱에서 의료 납품을 확인할 수 있습니다. 설치된 Chromium을 쓰려면 `RUSTLINE_CHROMIUM`에 실행 파일 경로를 지정하세요. 전리품 회전 회귀는 `CHROMIUM_BIN`을 읽는 `python3 tests/field-loot-rotation.py`로 실행합니다.

기능을 수정할 때는 `dev/src/`, `dev/Rustline_Database_v10.json`, `dev/tests/`를 편집합니다. 변경 후에는 재생성한 `development/Rustline-source.zip`과 `rustline-web/index.html`을 같은 커밋으로 반영하세요. Render 배포 디렉터리는 `rustline-web/`입니다.
