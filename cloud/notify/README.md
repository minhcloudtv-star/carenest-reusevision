# Telegram fallback

Configuration (server environment only):

- `TELEGRAM_BOT_TOKEN`: Telegram bot credential. Never expose through Vite.
- `NOTIFY_DB_PATH`: absolute writable path on persistent disk for SQLite. No default
  file is created in the repository. This database contains recipient identifiers;
  restrict file permissions and do not commit it.
- `BED_EXIT_FALLBACK_SECONDS`: positive number of seconds after the event timestamp,
  default 60. Worker polls every 5 seconds. This is a best-effort notification,
  not a guarantee of emergency response.

Start the bot conversation before testing. Telegram `sendMessage` accepts `chat_id`
plus text: https://core.telegram.org/bots/api#sendmessage . No images, person names,
identifiers or sensitive links are included in fallback text. Do not enable HTTP
request logging for Telegram: the URL includes the bot token.

## Integration still required in the current repository

The cloud currently has no authentication, event ingest/store or acknowledgement
API. This module does not invent a public unauthenticated event-ingest route.

1. Trusted auth middleware must set `app.state.authorize_notify` to an async
   callable `(request) -> scope_id`, rejecting unauthorized requests. Scope must
   come from verified identity/household membership. Check owner rights, CSRF for
   cookie sessions, and OTP when changing recipients. Without this callback all
   configuration/test endpoints return 503 (fail closed).
2. After persisting an event, call
   `app.state.fallback.record_event(scope_id, event_dict)` with the unchanged event
   schema. Process events in order per scope, including confirmed event updates.
3. On successful acknowledgement call
   `app.state.fallback.acknowledge(scope_id, event_id)` before responding. Backfill
   pending events from the authoritative store after an ingest interruption.

`GET/PUT /notify/telegram` read/save `{chat_id}` for the authorized scope; an empty
chat ID disables the channel. `POST /notify/telegram/test` sends to the saved chat.
There is no public endpoint to trigger fallback sends or select another scope.
UI uses VITE_API_URL and cookie credentials; adapt to the eventual auth contract.

The durable worker leases jobs to prevent concurrent normal sends and records
success to suppress duplicates. A delivery accepted by Telegram followed by a
process crash before persistence may be retried (at least once). An acknowledgement
received after the final check or while an HTTP send is in flight cannot retract
that message. Network failures retry after 60 seconds; disabling the channel or
acknowledging cancels future sends. Queue retention/cleanup and deployment-specific
rate limits must be addressed before production use.
