# Security policy

## Reporting a vulnerability

If you find a security issue in `homebridge-evcc`, **do not open a public GitHub issue.** Use GitHub's [private security advisory](https://github.com/matthiaseinig/Homebridge-EVCC/security/advisories) feature, or email the maintainer. Aim is to respond within 7 days.

When reporting, please include:

- Description of the issue and its impact
- Reproduction steps (Homebridge version, Node version, plugin version, config without the password)
- Suggested mitigation if you have one

## Supported versions

Only the latest minor release receives security fixes. While the plugin is below `1.0.0` it is considered alpha — backports are best-effort.

## Threat model

The plugin sits between three trust boundaries:

```
[ HomeKit / Home app ]  <-HAP->  [ this plugin ]  <-WSS/HTTPS->  [ EVCC server ]
```

| Boundary | Trusted? | Notes |
|---|---|---|
| HomeKit / Home app | Trusted | Apple's HAP layer authenticates every controller |
| EVCC server | Trusted, with caveats | Operator-trusted; the plugin treats incoming JSON as untrusted input and validates structure before use |
| Local Homebridge process | Trusted | Anyone with shell access to your Homebridge host can read the EVCC password |

## What the plugin does to protect you

- **Cookie auth, never URL-encoded passwords.** The admin password is sent only in the `POST /api/auth/login` body. The auth cookie is held in memory and never logged.
- **Password redaction.** At DEBUG level the password is partially redacted (`abcd***xy`); INFO and below never include it at all.
- **No dynamic code execution.** No `eval`, no `Function()`, no dynamic `require()`.
- **Bounded subprocesses.** The plugin spawns no child processes.
- **Strict JSON parsing.** Every websocket frame and REST response is `JSON.parse`'d in a `try`/`catch`. Malformed frames are dropped with a debug log.
- **Minimal dependencies.** One runtime dep (`ws`) and a small typed surface area. CI runs `npm audit --omit=dev --audit-level=high` on every PR.

## What you can do to protect yourself

- Keep the EVCC admin password out of version control. The plugin's `.gitignore` excludes the `dev/` sandbox by default.
- Run Homebridge under a non-privileged user account.
- If your EVCC instance is reachable outside your LAN, put it behind TLS and use the HTTPS URL.
- Keep Homebridge, Node.js, EVCC, and this plugin up to date.
