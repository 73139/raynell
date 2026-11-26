# 웹 러스트라인

이 브랜치(`rustline-web-reboot`)는 브라우저에서 플레이하는 **러스트라인 프로토콜**의 운영 소스입니다. [게임 실행](https://rustline-protocol-web.onrender.com/)

다른 작업 환경에서 개발을 이어갈 때는 최신 브랜치를 복제하고, 빈 디렉터리에 `development/Rustline-source.zip`을 복원하세요. `dev/build.py`로 빌드한 `dev/index.html`이 같은 커밋의 `rustline-web/index.html`과 일치하는지 확인할 수 있습니다. [빌드·회귀 테스트 방법](development/README.md)

운영판에서 제작과 레이드 만료를 실제 시간으로 관찰하려면 `python3 tests/live-endurance.py --help`를 확인하세요. 테스트 전용 상태 폴더와 시간대가 포함된 종료 시각을 지정합니다. 중단 후 같은 상태 폴더와 종료 시각으로 재시작하면 관찰한 시점과 놓친 시점이 따로 기록됩니다. [실시간 검증 도구](tests/live-endurance.py)

## Tarkov Field Guide

Tarkov Field Guide deployment files are kept on a separate branch (`tarkov-r16-free`) to avoid changing the default branch's content.
