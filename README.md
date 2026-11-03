# 60days

60 Day Prep: daily DSA tracker. Vercel + Neon Postgres, name + 4-digit PIN login.

Env vars: DATABASE_URL, SESSION_SECRET, ADMIN_NAME, ADMIN_PIN, SOLUTIONS_TOKEN.

Local: `npm install && ADMIN_NAME=me ADMIN_PIN=1234 npm run dev`

## Kotlin quiz

20 questions a day in `lib/quiz/day-NN.json` (kept server-side so answers aren't public). Day topics and the
roadmap live in `public/quiz-syllabus.json`, and each day file's `topic` must match it.

After editing any day file, run `node scripts/verify-quiz.mjs [day ...]`. It checks the format, runs every
"what does this print" snippet through `kotlinc` (3 times, to catch non-determinism) and checks every
`"compiles"` claim. It needs `kotlinc`/`kotlin` on PATH. kotlinx-coroutines comes from `~/.gradle`, or set `QUIZ_CLASSPATH`.
