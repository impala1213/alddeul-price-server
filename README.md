# 알뜰식단 가격 서버 (배포용)

네이버 쇼핑 실시간 최저가 API + 식단 앱을 함께 서빙하는 Node 서버입니다.
API 키는 코드에 없고, 배포 환경의 환경변수로만 주입합니다.

## Render 배포
1. 이 저장소를 Render에 **New + → Blueprint** 로 연결 (render.yaml 자동 인식)
2. **Environment** 에 환경변수 2개 입력:
   - `NAVER_CLIENT_ID`
   - `NAVER_CLIENT_SECRET`
3. 배포가 끝나면 `https://<이름>.onrender.com` 주소가 생깁니다.

## 엔드포인트
- `GET /` — 식단 앱
- `GET /health` — 상태 + 키 설정 여부
- `POST /api/prices` — 재료 배열 → 네이버 실시간 최저가(6시간 캐시)

키는 절대 코드/깃에 커밋하지 마세요. 환경변수로만 사용합니다.
