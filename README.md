# 웹 러스트라인

이 브랜치(`rustline-web-reboot`)는 브라우저에서 플레이하는 **러스트라인 프로토콜**의 운영 소스입니다. [게임 실행](https://rustline-protocol-web.onrender.com/)

다른 대화나 기기에서 이어갈 때는 이 브랜치의 최신 커밋을 기준으로 [게임 소스](dev/src), [물품·시설 데이터](dev/Rustline_Database_v10.json), [회귀 테스트](dev/tests)를 확인하세요. 저장소를 복제한 뒤 `python3 development/check-release.py`를 실행하면 소스가 운영 HTML과 다운로드용 소스 ZIP을 바이트 단위로 재현하는지 확인할 수 있습니다. [빌드·회귀 테스트 방법](development/README.md)

운영판에서 제작과 레이드 만료를 실제 시간으로 관찰하려면 `python3 tests/live-endurance.py --help`를 확인하세요. 테스트 전용 상태 폴더와 시간대가 포함된 종료 시각을 지정합니다. 중단 후 같은 상태 폴더와 종료 시각으로 재시작하면 관찰한 시점과 놓친 시점이 따로 기록됩니다. [실시간 검증 도구](tests/live-endurance.py)

## Tarkov Field Guide

Tarkov Field Guide deployment files are kept on a separate branch (`tarkov-r16-free`) to avoid changing the default branch's content.
