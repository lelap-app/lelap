# The standard library only, so no install step.
FROM python:3.13-alpine
WORKDIR /app
COPY addon.py ./
USER nobody
ENV PORT=8787
EXPOSE 8787
CMD ["python3", "addon.py"]
