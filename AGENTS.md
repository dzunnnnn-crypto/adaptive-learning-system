# Adaptive Learning System

Standalone review-ready source for a local learning app. Do not edit the original personal Learning System or deploy to a VPS as part of work in this repository.

- Current GitHub visibility must remain Private until the owner explicitly approves Public.
- Start: npm ci --ignore-scripts, npm start. Loopback only, default port 8809.
- Check: npm run check and npm audit. Tests use isolated temporary data.
- AI is opt-in with ENABLE_AI=1. Do not invoke paid providers or use personal credentials during checks.
- Never commit .local, .env, learning_memory.md, user answers, transcripts, subtitles, private PDFs or personal course libraries.
- Preserve content-version compatibility and existing runtime progress. No silent resets.
- Public sample: one embedded-only YouTube course, 14 chapters / 42 questions. Preserve original video attribution. MIT does not cover the source video.
- Before changing content or screenshots, inspect the actual course, source attribution and rendered UI. Keep user-facing Russian concise and avoid long dash characters.
