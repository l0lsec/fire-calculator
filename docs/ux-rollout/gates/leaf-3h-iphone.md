# Gates: UX rollout leaf 3h-iphone

OWNS: ios/FIREPlannerSync/App/**

Scope: the iPhone companion shows its three steps (Pair, Allow Wallet, Sync) with done marks, confirms before Unpair, and shows plain error text.

- [ ] G1: the app still builds for the Simulator
  CHECK: xcodebuild -project ios/FIREPlannerSync/FIREPlannerSync.xcodeproj -scheme FIREPlannerSync -destination 'generic/platform=iOS Simulator' build CODE_SIGNING_ALLOWED=NO
  EXPECT: BUILD SUCCEEDED
  EVIDENCE: pending

- [ ] G2: the sync format check still passes
  CHECK: pnpm verify:financekit
  EXPECT: FINANCEKIT_FORMAT_OK
  EVIDENCE: pending

- [ ] G3: in the Simulator, the not-paired, paired and Wallet-denied states each show numbered steps with done marks, and Unpair asks first (screenshots)
  EVIDENCE: pending
