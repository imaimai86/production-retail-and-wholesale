#!/bin/bash
set -e
cd server
npm install
npm run start &
cd ..
