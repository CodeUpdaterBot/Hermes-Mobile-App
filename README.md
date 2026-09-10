<div align="center">
  <a href="https://github.com/CodeUpdaterBot/Hermes-Mobile-App" target="_blank" rel="noreferrer">
    <img src="docs/assets/HermesMobileMark.png" alt="Hermes Mobile app logo" width="300" />
  </a>
  <h1>Hermes Mobile</h1>

  A polished, cross-platform control surface for Hermes Desktop host.

  Hermes Mobile hooks into your real Bots, sessions, tools, approvals, and credentials on the host PC—then puts the control surface in your pocket.

  [![Target iOS][badge-ios]][link-repo]
  [![Target Android][badge-android]][link-repo]
  [![Hermes Agent][badge-hermes]][link-hermes]
  [![Tauri v2][badge-tauri]][link-tauri]
  [![React 19][badge-react]][link-react]
</div>

<p align="center">
  <a href="#why-hermes-mobile">Why Hermes Mobile</a> •
  <a href="#current-product-capabilities">Capabilities</a> •
  <a href="#pair-an-android-phone-safely">Pair Android</a> •
  <a href="#run-locally">Build from Source</a> •
  <a href="https://hermes-agent.nousresearch.com/docs/">Hermes Docs</a>
</p>

> [!IMPORTANT]
> **Hermes Agent is required first.** Hermes Mobile is an independent companion client, not an agent runtime. Before using it, install and configure [Hermes Agent by Nous Research](https://hermes-agent.nousresearch.com/) on the host PC. Hermes Desktop or a running Hermes gateway provides the real Bots, sessions, tools, approvals, and credentials that Hermes Mobile securely controls.

## Why Hermes Mobile

Hermes Mobile is a beautiful cross-platform open-source mobile applicaiton that grants easy control of your Hermes Bots (thanks Nous!). It's mobile-native, beautifully compact at ~25MB, and all it really does is connect to your existing Hermes runtime/agents/bots/computer via Tailscale (see Tailscale instrucitons below or in-app).

<p align="center">
  <img src="docs/assets/HermesMobileReadmeHero.png" alt="Hermes Mobile promotional banner with the headline Give each Bot a job, bot role labels, and a blue-glowing smartphone showing an AI development chat" width="1200" />
</p>

Your host PC remains the authority for agents, credentials, approvals, tools, sessions, files, and durable history. Hermes Mobile is the secure control surface in your pocket.

Hermes Mobile is an independent community project, not affiliated with or endorsed by Nous Research or Hermes Agent. It grew from a genuine appreciation for their work and excitement around the new Bot capabilities.

## Run locally

```bash
pnpm install
pnpm dev
pnpm test
pnpm build
pnpm tauri dev
```

### Android

On a machine with Android SDK:

```bash
pnpm tauri android init
pnpm tauri android dev
```

### iOS

On macOS with Xcode:

```bash
pnpm tauri ios init
pnpm tauri ios dev
```

## Current product capabilities

- **Live Hermes mirror:** Reads actual Bot profiles, canonical Bot Chats, session rows, transcripts, models, timestamps, and previews from the running Hermes host.
- **Live chat control:** Resumes a real Hermes session over `/api/ws` JSON-RPC, sends `prompt.submit`, and renders streamed assistant/tool activity.
- **Host-owned authority:** The app never starts a model/runtime and never copies provider credentials into the frontend.
- **Bot and Session views:** Bots are profile-owned canonical chats; Sessions is the all-profile runtime session projection.
- **Mobile-native controls:** Pull-to-refresh, attachment routing through Hermes, live skill completion, themes, profile settings, and cross-profile scheduled tasks.
- **Secure pairing readiness:** Security & Pairing uses the real Hermes `/api/status` discovery check for a supplied Tailscale/HTTPS gateway URL and provides the safe Android connection model. It deliberately does not collect or persist a credential until the Android/iOS native secure-storage token/OAuth flow is wired.

## Pair an Android phone safely

1. Install [Tailscale](https://tailscale.com/) on the Windows Hermes host and Android phone, then sign in to the same Tailnet.
2. Run a reachable, authenticated Hermes gateway on the Windows PC.
3. Enter the PC’s Tailscale gateway URL on the phone—never `127.0.0.1` or `localhost`, which point back to the phone.
4. Verify reachability, then authenticate with the gateway’s supported session-token or OAuth flow.
5. Keep Hermes port `9119` private. Do **not** expose it directly to the public internet.

Hermes Desktop’s official [multi-connection gateway guide](https://hermes-agent.nousresearch.com/docs/user-guide/multi-connection-desktop) describes the supported remote-gateway contracts and authentication options.

### Install a private Tailscale host gateway

For a durable phone connection, install the host-side gateway service on the computer that runs Hermes. The portable Windows, macOS, and Linux installers discover Hermes and Tailscale, configure authenticated private access, and keep the gateway running after login:

- [Cross-platform installer guide](scripts/README.md)
- Windows: `scripts/setup-hermes-tailscale-gateway.cmd` (run as administrator)
- macOS: `./scripts/install-hermes-mobile-gateway.sh install`
- Linux (systemd): `./scripts/install-hermes-mobile-gateway-linux.sh install`

## Architecture

Read [ARCHITECTURE.md](ARCHITECTURE.md) before modifying the production bridge.

## Related projects

- [Hermes Mobile](https://github.com/CodeUpdaterBot/Hermes-Mobile-App)
- [Hermes Agent](https://github.com/NousResearch/hermes-agent)
- [Hermes Agent documentation](https://hermes-agent.nousresearch.com/docs/)
- [Nous Research Discord](https://discord.gg/NousResearch)

## Future improvements & ideas ✏️

These are planned directions for making Hermes Mobile an even richer companion for the Hermes host runtime. Have a cool improvement or update? Pull requests and collaboration are welcome!

### Agent experience & live operations

- [ ] **Actionable notification controls** — Let users choose which events generate notifications: completed Bot work, approval requests, clarification questions, scheduled-task results, errors, and mentions. Include actions such as **Open chat**, **Approve**, or **Reply** where safe.
- [ ] **Bot health and availability indicators** — Show whether a Bot is available, busy, disconnected, missing its host profile, or has recently failed. This is especially useful when several Bots run through the same Hermes host.
- [ ] **Approval and sensitive-action inbox** — Provide one place to review pending approvals, sudo prompts, clarification requests, and other actions that need the user’s attention.
- [ ] **Richer tool-call, thinking, and action presentation** — Bring more of Hermes Desktop’s detailed activity insight to mobile, including clearer tool progress, model activity, reasoning summaries, and action status. Add chat-level controls for showing detailed insights, compact summaries, or no reasoning/activity detail.
- [ ] **Plan mode and question handling** — Add a polished Plan mode and a clear way to review, answer, approve, or revise Bot questions and proposed plans without losing conversation context.
- [ ] **Group Chats** — Expand beyond the current one-Bot chat and session model to support multi-Bot group conversations with clear participant identity and delivery behavior.
- [ ] **More proactive chat synchronization** — Improve foreground refresh and live update behavior so streamed thinking, tool calls, and subsequent responses appear promptly without requiring a manual refresh tap.
- [ ] **Desktop screen and computer view** — Add an optional desktop/computer control entry point in the chat header so users can inspect a Bot’s available screen or view the Hermes Desktop computer when that capability is configured and authorized.

### Mobile interaction & design

- ✅ **Gestures and swipe navigation** — Add mobile-native gestures throughout the app, including Android edge/back gestures and intuitive swipe interactions for moving between screens and task/chat surfaces. **Thanks @SteStein.com**
- ✅ **Better Android Back and iOS navigation parity** — Make system Back, swipe-back, modal dismissal, nested task screens, and chat navigation feel consistent across Android, iOS, and desktop. **Thanks @SteStein.com**
- [ ] **Native-feeling motion and interaction polish** — Build the spring-damped animations, gesture settling, transition physics, haptics, and other small interaction niceties that native mobile apps often provide automatically, but that Hermes Mobile must deliberately implement across its Tauri surfaces.

### Platform, files & host connectivity

- [ ] **Automatic updates and release settings** — Add an optional update checker and user-controlled update settings backed by GitHub Releases, with clear version notes and safe install handoffs.
- [ ] **Attachment and file handoff improvements** — Add clearer upload progress, retry/remove controls, file-size limits, and host-side staging status while continuing to let Hermes interpret the files.
- [ ] **Host profiles and multiple gateways** — Allow one phone to securely remember multiple Hermes hosts or Tailscale gateways, with clear names such as “Home PC,” “Work Mac,” or “Linux Server.”

[badge-hermes]: https://img.shields.io/badge/Hermes%20Agent-Live%20control%20surface-F59E0B?style=flat-square
[badge-ios]: https://img.shields.io/badge/Target-iOS-7DD3FC?logo=apple&logoColor=white&style=flat-square
[badge-android]: https://img.shields.io/badge/Target-Android-3DDC84?logo=android&logoColor=white&style=flat-square
[badge-tauri]: https://img.shields.io/badge/Tauri-v2-24C8DB?logo=tauri&logoColor=white&style=flat-square
[badge-react]: https://img.shields.io/badge/React-v19-149ECA?logo=react&logoColor=white&style=flat-square
[link-hermes]: https://hermes-agent.nousresearch.com/
[link-tauri]: https://v2.tauri.app/
[link-react]: https://react.dev/
[link-repo]: https://github.com/CodeUpdaterBot/Hermes-Mobile-App

<p align="center">
  <img src="docs/assets/HermesMobileFooter.png" alt="Blue-and-white illustrated city beside a lake with a bridge and hilltop castle" width="1200" />
</p>
