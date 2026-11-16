# Attune

A self-hosted web app in which a built-in interviewing agent builds a deep
social, psychological and intimate portrait of each person, stores it locally,
and matches people on it. No internet connection and no AI service is used.

## Run it

1. Install Node.js (LTS, version 18 or newer) from https://nodejs.org
2. Double-click `start.bat` (Windows), or run `node server.js`
3. Open http://localhost:3000

To try matching before real users exist, stop the server and run:

    node tools/seed.js 60        creates 60 simulated people
    node tools/seed.js --clear   removes them

Simulated accounts: `demo1@example.test` ... password `demo-password-1`.

## How the agent works

`lib/engine.js` keeps, for each of 24 traits, an estimate and a confidence.

- Every trait starts with two questions worded in opposite directions.
- Confidence rises with each answer and falls when answers contradict each
  other or sit in the middle. Below the threshold, the agent asks a follow-up
  and tells the person why.
- Six traits that weigh most in matching (attachment anxiety and avoidance,
  closeness, desire, leading, yielding) have a higher threshold and always get
  a third question.
- The preference tree opens a branch only where the person rated the area
  "curious" or higher: first a give/receive/switch question where a role
  exists, then three specifics. 13 areas, 39 specifics.
- Every intimate question can be declined; a declined trait is left out of
  matching instead of being guessed.

An interview is 65 to 125 questions depending on the person.

## How matching works

`lib/match.js`, three layers:

1. Hard filters: mutual gender preference, mutual age range, shared intent,
   and deal-breakers (children, monogamy, smoking).
2. Three domain scores (mind, life, intimacy). Most traits score by
   similarity. Some score by dynamics: the anxious-avoidant pairing is
   penalised, lead/yield polarity is rewarded when complementary, and each
   shared preference counts fully only when roles fit. "Essential" against
   "hard limit" is a clash. Every component is weighted by how confident the
   agent is about both people.
3. Each person weights the domains by their own stated priorities; the final
   figure is the geometric mean of both directions, so it must work both ways.

Each match shows the score, a confidence figure, what draws the two together
and what they would need to talk about.

## Privacy built in

- 18+ gate on date of birth; explicit consent for sensitive data at sign-up.
- Passwords hashed with scrypt; sessions in HttpOnly, SameSite=Strict cookies.
- All data in `storage/`, encrypted with AES-256-GCM. Back up
  `storage/secret.key` separately: without it the data cannot be read.
- Nobody sees another person's answers. Specific shared preferences and
  contact details appear only after both people say yes.
- Export all my data, delete my account, block and report.
  `node tools/reports.js` lists reports.

## Before opening this to the public

This is a working prototype. A public service handling this kind of data
still needs:

- HTTPS (put Caddy or nginx in front; set `HOST=0.0.0.0`, `ATTUNE_SECURE=1`)
- Email verification and password reset
- Real age verification, a privacy policy, terms, and a data-protection
  impact assessment: sexual and psychological data are special-category data
  under GDPR Art. 9. Take legal advice before launch.
- A moderation screen, photos and in-app messaging
- A database server once there are more than a few thousand users
  (`lib/store.js` is the only file to replace)
- Native-speaker review of the translations, and validation of the
  questionnaire against real outcomes: the items follow established
  psychological constructs but have not been psychometrically tested.

## Files

    server.js          web server and API
    data/bank.js       traits, questions, preference tree (no wording)
    i18n/*.json        wording in en, ro, fr, de, es, zh, hi (382 strings each)
    lib/engine.js      the interviewing agent
    lib/profile.js     answers -> portrait
    lib/match.js       matching
    lib/store.js       encrypted local storage
    public/            the web interface
    tools/check.js     verifies every language pack is complete
    tools/seed.js      simulated people
    tools/reports.js   moderation reports
