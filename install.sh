#!/bin/bash
set -e
cd "$(dirname "$0")/server"
npm install
npm run start &
cd - >/dev/null
