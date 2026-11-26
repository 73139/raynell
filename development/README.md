# 러스트라인 웹 개발 소스

저장소의 `dev/`에 게임 모듈, 데이터, 원본 WebP, 회귀 테스트가 들어 있습니다. 브랜치를 복제한 뒤 다음 명령으로 소스를 빌드하고 테스트할 수 있습니다.

```sh
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

기능을 수정할 때는 `dev/src/`, `dev/Rustline_Database_v10.json`, `dev/tests/`를 편집합니다. 변경한 소스와 테스트, 재생성한 `development/Rustline-source.zip`과 `rustline-web/index.html`을 같은 커밋으로 반영하세요. Render 배포 디렉터리는 `rustline-web/`입니다.


## 다른 작업 환경에서 이어가기

저장소 루트에서 `python3 development/check-release.py`를 실행하면 임시 폴더에서 빌드해 두 배포 파일을 대조합니다. Python 3 표준 라이브러리만 사용합니다. 소스 ZIP만 받은 경우 빈 폴더에서 `python3 -m zipfile -e Rustline-source.zip .`으로 같은 모듈과 테스트를 복원할 수 있습니다.

실행 환경에 연결할 수 없는 동안에는 GitHub에서 커밋을 먼저 고정하고 `dev/src/`의 해당 모듈과 `dev/tests/`의 검사를 함께 열어 변경 후보를 작성할 수 있습니다. 실행 환경이 복구되면 최신 운영 브랜치와 차이를 대조하고 빌드·회귀·브라우저 검증을 마칩니다.
