#!/bin/sh
# Ships the planner: builds it with the site's own environment variables and
# publishes it to https://ugc-planner.netlify.app. Run on a machine that is
# logged in to Netlify (`npx netlify login` once) - the same login that ships
# the Cutter. The repository is not connected to Netlify, so pushing to
# GitHub alone deploys nothing; this does.
set -e
cd "$(dirname "$0")"
npm ci --ignore-scripts
npx netlify link --id 02dcbc49-d87c-4d36-ad8a-2190d23740c0 >/dev/null 2>&1 || true
npx netlify deploy --prod --build
