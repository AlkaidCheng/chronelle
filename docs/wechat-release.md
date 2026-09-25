# WeChat release readiness

This checklist is for the native Mini Program in `apps/wechat`. It does not
declare the application ready for submission. A production release requires a
registered AppID, configured WeChat domains, staging evidence from real devices,
and a review of the current platform requirements. The web and Mini Program
must continue to use the same Chronelle API and canonical records.

## Build preflight

In the same shell, set the public build inputs for the intended environment:

```bash
export TARO_APP_ID=<registered-mini-program-app-id>
export TARO_APP_API_BASE_URL=<public-https-api-origin>
export TARO_APP_CLOUDBASE_ENV_ID=<associated-cloudbase-environment-id>
export TARO_APP_CLOUDBASE_USE_WX_CLOUD=false
pnpm --filter @chronelle/wechat build
pnpm --filter @chronelle/wechat release:preflight
```

Set `TARO_APP_CLOUDBASE_USE_WX_CLOUD=true` only when the Mini Program is
associated with that CloudBase environment. The preflight checks the public
HTTPS API origin, the explicit CloudBase mode, the AppID emitted into the
compiled project, and the set of `TARO_APP_` variables that Taro may embed in
the package. It rejects unreviewed variables, including ones named for secrets.
It cannot prove the AppID belongs to the account, that TLS and network access
work, or that the WeChat console allows the required domains. Never put the
WeChat AppSecret, a CloudBase API key, a Chronelle session, or a COS credential
in a `TARO_APP_` variable or the Mini Program project files.

## Domain and environment verification

Keep staging and production credentials, CloudBase environments, API origins,
COS buckets, and Mini Program releases separate. Record the actual hostname
observed for each operation in a staging network trace, then configure the
corresponding domain category in the WeChat console:

| Operation                                         | Current client path                                    | Evidence to record                                                      |
| ------------------------------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------- |
| Chronelle API reads, writes, and sign-in exchange | `Taro.request` to the configured API origin            | Request domain, TLS result, authenticated and unauthenticated responses |
| Attachment upload                                 | `Taro.uploadFile` to a one-use API transfer URL        | Upload domain, expiry, one-use behavior, finalize result                |
| Attachment download                               | `Taro.downloadFile` to a short-lived server-issued URL | Every issued download hostname, expiry, unauthorized denial             |
| CloudBase identity proof                          | CloudBase SDK, with optional `Taro.cloud` mode         | Actual identity network path and environment association                |

The API upload ticket currently uses the API origin. Download URLs and
CloudBase identity traffic must be observed rather than inferred from the API
origin; provider configuration can change their hosts. Do not disable domain
checks in a release build. Re-run this verification when the storage provider,
identity mode, ingress, or deployment environment changes.

## Data and privacy inventory

Review this inventory against the actual package and the current WeChat
privacy-declaration interface before submission. It describes implementation,
not a legal conclusion or a completed declaration.

| Data or capability                             | Purpose and boundary                                                                                     | Local handling                                                                                                                                   |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| WeChat identity proof                          | Exchanged with the Chronelle API for a revocable account session; not used as a business-data permission | Not persisted by the Mini Program                                                                                                                |
| Chronelle session token and workspace selector | Authenticated API access; server authorization still decides every protected request                     | Stored by the native session store; cleared on sign-out                                                                                          |
| Event, planning, Person, and Friends data      | User-entered canonical records and account relationships read and changed through the API                | Query cache and bounded editor drafts; no separate Mini Program database                                                                         |
| Attachment content and metadata                | User-selected file transfer and authorized opening                                                       | Selected files are removed after transfer; downloaded copies are cleaned when the Files component closes; canonical metadata stays on the server |
| Network state and application lifecycle        | Revalidate protected queries after reconnect or resume                                                   | Used in memory; no analytics event is emitted by this client                                                                                     |

The current client uses `chooseMessageFile`, `uploadFile`, `downloadFile`,
`openDocument`, and `previewImage`. It does not call a location, address-book,
phone-number, or subscription-message API. Recheck this list and the bundled
dependencies before filing privacy declarations. Do not claim that a local
temporary file is secure storage or that a successful compile validates a
platform privacy review.

## Staging acceptance and release record

Use synthetic Owner, Viewer, unrelated, revoked, and expired accounts. Capture
the release revision, package report, test environment, device/OS/WeChat
versions, and outcomes without storing personal data or tokens in the record.

- Run the cross-client acceptance journey: create and edit one canonical Event
  across web and Mini Program, attach once, share as Viewer, revoke access, and
  recover the same records from Trash.
- On real iOS and Android devices, check cold and warm launch, Chinese IME,
  long text, large text settings, safe areas, screen-reader labels, reduced
  motion, app suspension, poor network, interrupted uploads, and retry.
- Repeat attachment download after access revocation and after URL expiry.
  Confirm that a stale version cannot overwrite a newer canonical object.
- Inspect API request IDs, error rates, authentication exchange failures,
  transfer authorization/finalize failures, and latency. Keep tokens, file
  content, signed URLs, People contacts, and request bodies out of operational
  logs and error reporting.
- Review the privacy declaration and release metadata in the WeChat console,
  including the registered name and the avatar (`wechat/avatar-512.png` from
  `pnpm brand:export`; see the [brand guide](../brand/README.md)).
  Submit only after the staging journey and all device/domain/privacy checks
  pass. Record the approved package version and the API revision it expects.

If a release fails, stop rollout and return to the previously approved Mini
Program package in the platform console. Keep the API compatible with that
package during rollout; roll back the API only with an explicit compatibility
and data-migration assessment. Do not reverse a database migration or delete
canonical records as a routine rollback step.

The AppID, console configuration, real-device checks, and platform review are
external release gates. The repository preflight and automated tests cannot
substitute for them.
