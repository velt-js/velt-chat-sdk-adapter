# Changelog

All notable changes to `@veltdev/chat-sdk-adapter` are documented here. The format
is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.4]

### Changed
- Sharpened the package description to reflect read / reply / mention / start-thread
  capabilities.

## [0.2.3]

### Added
- Outbound mentions: `adapter.mentionUser(userId)` returns a `{{userId}}` token;
  posting a message containing it resolves the name (via `resolveUsers`), rewrites
  it to `@Name`, and sets `to` / `taggedUserContacts` so Velt notifies the user.

### Changed
- Aligned `@chat-adapter/shared` to `^4.30.0` so the whole `chat` ecosystem
  (incl. `@chat-adapter/state-redis`) dedupes to a single `chat` version.

## [0.2.2]

### Changed
- Sharpened the package description (anchored, multi-surface comments). No code changes.

## [0.2.1]

First published build of the channel-methods + attachments work (0.2.0 was not
released).

### Added
- Channel/document-level methods, all backed by Velt's **managed** REST API:
  - `listThreads(channelId)` and `fetchChannelMessages(channelId)` — via
    `/v2/commentannotations/get` (lists a document's annotations).
  - `fetchChannelInfo(channelId)` — via `/v2/organizations/documents/get`.
  - `postChannelMessage(channelId, message)` — creates a new annotation via
    `/v2/commentannotations/add`.
  - `fetchMessage(threadId, messageId)` — a single comment by id.
- Comment **attachments**: inbound attachments are parsed into Chat SDK
  `Attachment`s (previously dropped), and attachment references are forwarded when
  posting.

### Changed
- Renamed npm scope `@velt-js/chat-sdk-adapter` → `@veltdev/chat-sdk-adapter`.
  The old package is deprecated and redirects here.

### Tests
- Added config + error-mapping coverage and tests for the new channel /
  message-history methods and attachment parsing (78 tests total).

## [0.1.0]

Initial release.

### Added
- `VeltAdapter` implementing the Chat SDK `Adapter` contract for Velt comment
  threads: thread-id encoding, `parseMessage`, `postMessage` / `editMessage` /
  `deleteMessage`, `fetchMessages` / `fetchThread`, `renderFormatted`,
  `startTyping` (no-op), and `handleWebhook`.
- `createVeltAdapter()` factory with environment-variable fallbacks.
- `VeltFormatConverter` — Velt `commentHtml` ⇄ Chat SDK mdast; mention-token
  normalization (`{{userId}}` → `@Name`).
- Webhook verification for both Velt systems: Advanced (v2, Svix-style HMAC,
  default) and Basic (v1, `Authorization: Basic`).
- Document context surfaced on each message (`documentName` / `documentUrl` /
  `anchoredText`).
- Inbound reactions via `onReaction`; reaction writes degrade with a clear error
  on the managed backend (self-hosted only).
- Example apps: `nextjs-velt-bot` (greeting) and `nextjs-velt-ai-bot` (streaming
  Claude), plus a Railway `Dockerfile`.

[Unreleased]: https://github.com/velt-js/velt-chat-sdk-adapter/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/velt-js/velt-chat-sdk-adapter/releases/tag/v0.1.0
