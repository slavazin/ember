FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Both build sources ship in the image; $BUILD selects which one uvicorn runs, so
# a rollback is a redeploy of the same image with a different build id.
COPY app_2026_09_02.py app_2026_09_09.py entrypoint.sh ./
RUN chmod +x entrypoint.sh

EXPOSE 8000

ENTRYPOINT ["./entrypoint.sh"]
