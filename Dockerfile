FROM python:3.13-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PODRYADI_DATA_DIR=/app/data PODRYADI_COOKIE_SECURE=true
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt && useradd -m -u 10001 podryadi
COPY app ./app
RUN mkdir -p /app/data && chown -R podryadi:podryadi /app
USER podryadi
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "127.0.0.1"]
