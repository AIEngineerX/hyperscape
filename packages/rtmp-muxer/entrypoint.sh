#!/usr/bin/env sh
set -e

# Substitute environment variables in the nginx config template
envsubst '${TWITCH_STREAM_KEY} ${YOUTUBE_STREAM_KEY}' < /etc/nginx/nginx.conf.template > /etc/nginx/nginx.conf

# Start NGINX
exec nginx -g 'daemon off;'
