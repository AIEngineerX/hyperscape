FROM tiangolo/nginx-rtmp:latest

COPY nginx.conf.template /etc/nginx/nginx.conf.template
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Install gettext-base for envsubst
RUN apt-get update && apt-get install -y gettext-base && rm -rf /var/lib/apt/lists/*

EXPOSE 1935
EXPOSE 8080

CMD ["/entrypoint.sh"]
