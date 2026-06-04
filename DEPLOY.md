# Deploy WeddingStory

Rekomendacja: Railway albo Render z trwałym dyskiem/volume.

Wymagane env:
- ADMIN_TOKEN=dlugie-losowe-haslo
- STORAGE_ROOT=/data

Start command:
- npm start

Health check:
- /api/health

Volume mount path:
- /data

Po deployu sprawdź:
- /api/health
- upload z telefonu przez domenę https
- /organizer z tokenem
- pobieranie ZIP
