## Tech Stack & Tools

### Test Design & Automation
- **Postman**
  - API 테스트 시나리오 설계
  - Pre-request / Post-response Script 작성
  - 환경 변수 및 공통 검증 로직 구성
- **Newman**
  - Postman Collection 기반 CLI 자동 실행
  - Iteration 기반 반복 실행으로 API 안정성 테스트 수행
  - CLI / HTML Reporter 연동

### CI / Pipeline
- **GitHub Actions**
  - Push / Manual / Scheduled 기반 테스트 실행
  - Ubuntu Runner 환경에서 자동 테스트 파이프라인 구성
  - CI 실패 기준을 로그 기반 품질 게이트로 제어

### Quality Gate & Validation
- **Node.js (Custom Script)**
  - newman.log 파싱을 통한 Assertion 실패 횟수 집계
  - Threshold 기반 CI Pass / Fail 판단
  - 테스트 결과를 정량 지표로 변환

### Reporting & Visibility
- **newman-reporter-htmlextra**
  - HTML 테스트 리포트 자동 생성
  - 테스트 결과 공유 및 디버깅 용이성 확보
- **Slack**
  - CI 성공 / 실패 결과 실시간 알림
  - 로그 기준 실패 정보 전달로 커뮤니케이션 신뢰도 향상

### Execution Strategy
- **Iteration-based Stability Testing**
  - 단발성 테스트가 아닌 반복 실행을 통한 신뢰성 검증
- **Scheduled Execution (cron)**
  - 정기 실행을 통한 API 헬스 체크 및 운영 관점 품질 관리
