#!/bin/bash
set -e

if [ -z "$1" ]; then 
  echo "Usage: sh docker-build-run.sh [prod|dev]"; 
  echo "       sh docker-build-run.sh dev"; 
  exit 1
fi

env=$1
image_name="a2a-agent-builder-${env}"
container_name="a2a-agent-builder-${env}"

if [ "${env}" = "prod" ]; then
  host_port=3001
else
  host_port=3007
fi

echo "Building Docker image '${image_name}'..."
sudo docker build -t ${image_name} .

echo "Removing existing container '${container_name}' if exists..."
sudo docker rm -f ${container_name} || true

echo "Starting new container '${container_name}'..."
if [ "${env}" = "prod" ]; then
  sudo docker run -d -it \
    --restart unless-stopped \
    -p ${host_port}:3001 \
    --name ${container_name} \
    --env-file ./.env.${env} \
    --add-host=host.docker.internal:host-gateway \
    ${image_name}
else
  sudo docker run -d -it \
    --restart unless-stopped \
    -p ${host_port}:3001 \
    --name ${container_name} \
    --env-file ./.env.${env} \
    ${image_name}
fi

echo "Running container '${container_name}' on port ${host_port}."