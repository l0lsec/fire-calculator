# Gates: UX rollout leaf 3h-iphone

OWNS: ios/FIREPlannerSync/App/**

Scope: the iPhone companion shows its three steps (Pair, Allow Wallet, Sync) with done marks, confirms before Unpair, and shows plain error text.

- [x] G1: the app still builds for the Simulator
  CHECK: xcodebuild -project ios/FIREPlannerSync/FIREPlannerSync.xcodeproj -scheme FIREPlannerSync -destination 'generic/platform=iOS Simulator' build CODE_SIGNING_ALLOWED=NO
  EXPECT: BUILD SUCCEEDED
  EVIDENCE: exit=0; shell=/bin/sh; cwd=<repo>; path=cac86490b0a1/25 entries; output=2026-11-26 03:31:33.215 xcodebuild[34729:6969145] [MT] IDERunDestination: Supported platforms for the buildables in the current scheme is empty. | 2026-11-26 03:31:33.278 xcodebuild[34729:6969145] [MT] IDESchemeActionsInvocationRecord: Devi

- [x] G2: the sync format check still passes
  CHECK: pnpm verify:financekit
  EXPECT: FINANCEKIT_FORMAT_OK
  EVIDENCE: exit=0; shell=/bin/sh; cwd=<repo>; path=cac86490b0a1/25 entries; output=FINANCEKIT_FORMAT_OK (Swift sealed, Mac opened and parsed; wrong key refused) | $ node --import tsx scripts/verify/financekit-swift-format.ts

- [x] G3: in the Simulator, the not-paired and paired states show numbered steps with done marks and a "N of 3 steps done" bar, disabled steps say why, Unpair asks first, and errors read plainly (screenshots)
  EVIDENCE: iPhone 17 Simulator 2026-11-26, ad-hoc signed Debug build: evidence/iphone-1-not-paired.png (0 of 3, "Pair with your Mac first."), iphone-3-paired.png (1 of 3, step 1 checked, "Allow Wallet access first."), iphone-4-unpair-asks.png (confirmation names the consequence; Cancel kept the pairing), iphone-2-plain-error.png and iphone-5-wallet-unavailable.png (plain messages). Found and fixed: the confirmation did not appear until anchored to the Unpair button; two raw iOS error strings.

- [ ] G4: on a real iPhone, the Wallet-denied state shows its step and the Settings path (FinanceKit is not available in the Simulator, so this state could not be produced there)
