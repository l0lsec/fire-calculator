# iPhone companion: Apple Card, Apple Cash and Savings

Plaid cannot connect an Apple Card from a website or a desktop app. Apple only
shares Apple Card, Apple Cash and Savings with iPhone apps, through FinanceKit.
`ios/FIREPlannerSync` is a small iPhone app that does exactly one thing: read
those accounts (with your permission) and hand them to FIRE Planner on your Mac.

## How data moves

1. On the Mac, **Connections > Pair iPhone** creates a random 256-bit key and
   shows it once as a pairing code (`fp1.<pairing id>.<key>`). The Mac keeps it
   sealed with `TOKEN_ENCRYPTION_KEYS`, like bank tokens.
2. You paste the code into the iPhone app (Universal Clipboard works). The phone
   keeps it in its Keychain.
3. The phone reads accounts, balances and transactions through FinanceKit,
   encrypts the snapshot with AES-256-GCM, and writes `<pairing id>.fpsync` into
   its iCloud Drive folder. iOS 26 and later wake the app's background-delivery
   extension when new activity arrives, so this keeps happening without opening
   the app.
4. iCloud mirrors the file to
   `~/Library/Mobile Documents/iCloud~com~showupshowout~fireplanner/Documents`.
   FIRE Planner imports it whenever you open it (and on `pnpm sync`).

Apple stores only ciphertext. Nothing listens on your network. A file from an
older pairing or encrypted with any other key is refused.

The format is defined twice, in `apps/web/src/server/financekit/format.ts` and
`ios/FIREPlannerSync/Shared/SyncFormat.swift`. `pnpm verify:financekit` compiles
the Swift side for macOS, has it seal a sample, and requires the Mac side to
open and parse it.

## One-time setup

FinanceKit is a managed entitlement: Apple must approve it for your team first.

1. Request it at https://developer.apple.com/contact/request/financekit while
   signed in as the Account Holder of an organization team.
2. When Apple approves, open `ios/FIREPlannerSync/FIREPlannerSync.xcodeproj` in
   Xcode, add the organization team under Settings > Accounts, and pick it on
   both targets (Signing & Capabilities). Automatic signing registers the App
   ID, the iCloud container `iCloud.com.showupshowout.fireplanner` and the app
   group `group.com.showupshowout.fireplanner`.
3. Plug in your iPhone (iOS 18 or later; iOS 26 or later for background sync),
   pick it as the run destination, and press Run.
4. On the phone: **Paste pairing code**, **Allow Wallet access**, **Sync now**.

### Background sync is off until Apple grants the extension

Apple granted FinanceKit for `com.showupshowout.fireplanner` only (case
23759728, November 2026). The background-delivery extension
(`com.showupshowout.fireplanner.BackgroundDelivery`) needs its own grant, so it
cannot be signed yet, and the app target no longer builds or embeds it. Until
then the phone syncs whenever you open the app or tap **Sync now**.

When Apple adds the extension's bundle ID: in Xcode, select the FIREPlannerSync
target, add BackgroundDelivery back under Build Phases > Target Dependencies,
and add the "Embed ExtensionKit Extensions" phase with `BackgroundDelivery.appex`
(or revert the commit "Build the iPhone app without the background extension").

Privacy policy for the app: [PRIVACY-SYNC.md](PRIVACY-SYNC.md).

What FinanceKit does not report: the Apple Card APR. The card arrives in the
debt plan as "rate needed"; enter it once on the Debts page.
