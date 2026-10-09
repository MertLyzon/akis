#!/bin/sh
set -eu

# Keep the same image usable with Docker Compose and Northflank. Only our
# placeholder is substituted; nginx variables such as $host remain intact.
upstream="${API_UPSTREAM:-api:8000}"
sed "s|__API_UPSTREAM__|${upstream}|g" \
  /etc/nginx/conf.d/default.conf.template \
  > /etc/nginx/conf.d/default.conf

exec "$@"
