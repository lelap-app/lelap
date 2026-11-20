---
'@lelap/sdk': minor
---

Protocol revision 15. The app sends its own revision as a `Lelap-Protocol` header on every
resource request to an add-on that declares revision 15 or higher (never on the manifest or on
audio), and handlers get it as `appProtocol`: absent for an app at revision 14 or older, or when
the value is not a whole number (`parseAppProtocol`). A manifest can name the lowest app revision
it works with as `minProtocolVersion`; `createAddon({ minProtocolVersion })` puts it in the
manifest and answers `426 Upgrade Required` with a short plain-text body by itself to an app that
sends a lower revision or none. The CORS preflight now sends `Access-Control-Max-Age: 86400` and
keeps `Access-Control-Allow-Headers: *` (`PREFLIGHT_HEADERS`). New helpers: `PROTOCOL_HEADER`,
`sendsAppProtocol` and `needsNewerApp`. `lelap-sdk check` sends the header as the app does, and
warns when `minProtocolVersion` is above `protocolVersion`, when it is set without revision 15,
and when an add-on of revision 15 answers a preflight without allowing `Lelap-Protocol`.
