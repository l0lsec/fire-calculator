import FinanceKit
import SwiftUI

struct ContentView: View {
    @Bindable var model: SyncModel

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Text("Sends your Apple Card, Apple Cash and Savings activity to FIRE Planner on your Mac. Everything is encrypted on this phone with a key only your Mac knows, then dropped in this app's iCloud Drive folder.")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                }

                Section("1. Pair with your Mac") {
                    if let p = model.pairing {
                        Label("Paired (\(p.pairingID.prefix(6)))", systemImage: "checkmark.circle.fill")
                            .foregroundStyle(.green)
                        Button("Unpair", role: .destructive) { model.unpair() }
                    } else {
                        Text("On the Mac, open FIRE Planner, go to Connections, tap Pair iPhone, then Copy code.")
                            .font(.callout)
                        Button("Paste pairing code") { model.pasteCode() }
                    }
                }

                Section("2. Allow Wallet access") {
                    switch model.authorization {
                    case .authorized:
                        Label("Allowed", systemImage: "checkmark.circle.fill").foregroundStyle(.green)
                    case .denied:
                        Text("Wallet access was denied. Turn it on in Settings > Apps > FIRE Planner Sync > Wallet.")
                            .font(.callout)
                    default:
                        Button("Allow Wallet access") { Task { await model.allowWalletAccess() } }
                            .disabled(model.pairing == nil)
                    }
                }

                Section("3. Sync") {
                    Button {
                        Task { await model.syncNow() }
                    } label: {
                        if model.busy { ProgressView() } else { Text("Sync now") }
                    }
                    .disabled(model.busy || model.pairing == nil || model.authorization != .authorized)
                    if let last = model.last {
                        if let error = last.error {
                            Label(error, systemImage: "exclamationmark.triangle.fill").foregroundStyle(.red)
                        } else {
                            Text("Last sync \(last.finishedAt.formatted(date: .abbreviated, time: .shortened)): \(last.accounts) accounts, \(last.transactions) transactions.")
                                .font(.callout)
                        }
                    }
                    Text("After this, new activity syncs on its own in the background.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }

                if let message = model.message {
                    Section { Text(message).font(.callout) }
                }
            }
            .navigationTitle("FIRE Planner Sync")
            .task { await model.refreshStatus() }
        }
    }
}
