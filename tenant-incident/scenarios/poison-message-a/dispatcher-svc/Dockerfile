FROM python:3.12-alpine

WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY worker.py ./

EXPOSE 9000

# Single worker on purpose: one consumer of the ordered queue, so the only lever
# on a poisoned head is to quarantine it. A second worker would block on the same
# head and mask the cause.
CMD ["python", "worker.py"]
