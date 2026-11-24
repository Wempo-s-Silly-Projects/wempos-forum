---
name: block-playwright-chrome
enabled: true
event: bash
pattern: (?i)--browser[= ]["']?(?!(?:firefox|chromium|webkit)\b)[a-z]|\bchannel["']?\s*[=:]\s*["']?(?!(?:chromium)\b)[a-z]|\bopen\s+(?:-\w+\s+)*-a\s+["']?(?!(?:firefox|chromium|librewolf|icecat|tor browser|ungoogled|epiphany|gnome web)\b)(?:aol|avast|google chrome|chrome|comodo|dragon|icedragon|microsoft edge|edge|flock|icab|internet explorer|lunascape|maxthon|maxathon|mosaic|netscape|omniweb|opera|puffin|safari|salamweb|sleipnir|srware|iron|torch|vivaldi|yandex|arc|atlas|coc coc|comet|ecosia|epic|huawei|qq|samsung|silk|uc|whale|brave)|(?:^|[;&|(]\s*)(?:sudo\s+)?(?:google-chrome(?:-stable|-beta|-unstable)?|chrome(?:\.exe)?|msedge(?:\.exe)?|microsoft-edge(?:-stable|-beta|-dev)?|opera|vivaldi(?:-stable)?|brave(?:-browser)?|yandex-browser|iexplore(?:\.exe)?)(?:\s|$)|\bstart(?:-process)?\s+(?:-\w+\s+)*["']?(?:chrome|msedge|microsoft-edge:|opera|vivaldi|brave|iexplore)\b|\bxdg-open\s|\bcmd(?:\.exe)?\s+/c\s+start\b
action: block
---

🚫 **Only free-software browsers may be launched** (owner, Nov 22: "playwright is fine now but NO CHROME"; "its fine as long as the BROWSER is free/libre open source software"; Nov 22 21:56 listed many more proprietary browsers "and more").

Allowlist, not blocklist: Playwright `--browser` may only be `firefox`, `chromium` or `webkit` (open-source WebKit, not Safari — owner 21:57: "WebKit browsers are fine as long as its open source"); `channel` only `chromium`; anything else is blocked. Launching proprietary browsers by name (Chrome, Edge, Safari, Opera, Vivaldi, Yandex, Arc, Brave, Samsung, UC, …) is blocked. Allowed: Firefox (preferred), Chromium, and free derivatives (LibreWolf, GNU IceCat, Tor Browser, ungoogled-chromium).
