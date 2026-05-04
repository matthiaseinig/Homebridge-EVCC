# Local Homebridge dev sandbox

`npm run dev` boots a local Homebridge instance using `./dev/` as its `-U` user-storage directory. This folder is **git-ignored** — anything you put here (including your real EVCC password and HomeKit pairing tokens) stays on your machine.

To get started, copy `config.example.json` to `config.json`, fill in your EVCC URL and password, then `npm run dev`.
