FROM python:3.12-alpine

WORKDIR /app

COPY loadgen.py ./

# Stdlib only; no package installs.
CMD ["python", "loadgen.py"]
