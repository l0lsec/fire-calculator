# FIRE Planner Sync: privacy policy

Effective November 26, 2026. Published by Show Up Show Out LLC.

FIRE Planner Sync is a companion iPhone app for FIRE Planner, an open-source
financial independence planner that runs on the user's own Mac. This policy
covers what the iPhone app reads and where that data goes.

## What the app reads

Only with your permission, given in the Apple Wallet authorization screen, the
app reads through Apple's FinanceKit:

- the Apple Card, Apple Cash and Apple Savings accounts you choose to share;
- their balances and credit details (limit, minimum payment, due date);
- their transactions (date, amount, description, merchant name and category).

It reads nothing else: no contacts, location, photos, identifiers or other apps'
data.

## Where the data goes

- The app encrypts the data on your iPhone (AES-256-GCM) with a key that was
  created on your own Mac and copied to the phone when you paired them.
- It saves the encrypted file in the app's folder in **your** iCloud Drive.
  Apple stores only the encrypted file and cannot read it.
- Your Mac decrypts it locally and adds it to FIRE Planner on that Mac.

There is no server operated by us or anyone else. We never receive, see, store,
sell, share or rent your data. The app has no analytics, advertising or
tracking, and makes no network requests of its own; iCloud Drive moves the
encrypted file between your own devices.

## How long it is kept and how to delete it

- On the iPhone: tap **Unpair** to delete the key, or delete the app.
- In iCloud Drive: delete the **FIRE Planner Sync** folder.
- On the Mac: **Connections > Unpair** stops imports; **Delete everything**
  removes all data from FIRE Planner.
- To stop access at the source: Settings > Apps > FIRE Planner Sync > Wallet.

## Children

The app is not directed to children under 13 and does not knowingly collect
their data.

## Changes and contact

Changes to this policy are published at this address, with a new effective
date. Questions: open an issue at https://github.com/l0lsec/fire-calculator/issues.
