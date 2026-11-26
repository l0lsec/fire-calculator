import FinanceKit
import SwiftUI

struct ContentView: View {
    @Bindable var model: SyncModel
    @State private var confirmingUnpair = false

    private var paired: Bool { model.pairing != nil }
    private var allowed: Bool { model.authorization == .authorized }
    private var synced: Bool { model.last != nil && model.last?.error == nil }
    private var doneCount: Int { [paired, allowed, synced].filter { $0 }.count }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Text("Sends your Apple Card, Apple Cash and Savings activity to FIRE Planner on your Mac. Everything is encrypted on this phone with a key only your Mac knows, then dropped in this app's iCloud Drive folder.")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                    ProgressView(value: Double(doneCount), total: 3) {
                        Text(doneCount == 3 ? "All set" : "\(doneCount) of 3 steps done")
                            .font(.footnote)
                    }
                    .accessibilityValue("\(doneCount) of 3 steps done")
                }

                Section {
                    if let p = model.pairing {
                        Label("Paired (\(p.pairingID.prefix(6)))", systemImage: "checkmark.circle.fill")
                            .foregroundStyle(.green)
                        Button("Unpair", role: .destructive) { confirmingUnpair = true }
                            .confirmationDialog(
                                "Unpair this iPhone?",
                                isPresented: $confirmingUnpair,
                                titleVisibility: .visible
                            ) {
                                Button("Unpair", role: .destructive) { model.unpair() }
                                Button("Cancel", role: .cancel) {}
                            } message: {
                                Text("Syncing stops. Data already on your Mac stays there. To sync again you paste a new pairing code from the Mac.")
                            }
                    } else {
                        Text("On the Mac, open FIRE Planner, go to Accounts, then Connections, tap Pair iPhone, then Copy code.")
                            .font(.callout)
                        Button("Paste pairing code") { model.pasteCode() }
                    }
                } header: {
                    StepHeader(number: 1, title: "Pair with your Mac", done: paired)
                }

                Section {
                    switch model.authorization {
                    case .authorized:
                        Label("Allowed", systemImage: "checkmark.circle.fill").foregroundStyle(.green)
                    case .denied:
                        Text("Wallet access is off. Turn it on in Settings > Apps > FIRE Planner Sync > Wallet, then come back.")
                            .font(.callout)
                    default:
                        Button("Allow Wallet access") { Task { await model.allowWalletAccess() } }
                            .disabled(!paired)
                        if !paired {
                            Text("Pair with your Mac first.").font(.footnote).foregroundStyle(.secondary)
                        }
                    }
                } header: {
                    StepHeader(number: 2, title: "Allow Wallet access", done: allowed)
                }

                Section {
                    Button {
                        Task { await model.syncNow() }
                    } label: {
                        if model.busy {
                            HStack(spacing: 8) {
                                ProgressView()
                                Text("Syncing...")
                            }
                        } else {
                            Text("Sync now")
                        }
                    }
                    .disabled(model.busy || !paired || !allowed)
                    if !paired || !allowed {
                        Text(!paired ? "Pair with your Mac first." : "Allow Wallet access first.")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                    if let last = model.last {
                        if let error = last.error {
                            Label(error, systemImage: "exclamationmark.triangle.fill").foregroundStyle(.red)
                            Text("Try Sync now again. If it keeps failing, unpair and pair with a new code.")
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                        } else {
                            Label(
                                "Last sync \(last.finishedAt.formatted(date: .abbreviated, time: .shortened)): \(last.accounts) accounts, \(last.transactions) transactions.",
                                systemImage: "checkmark.circle.fill"
                            )
                            .font(.callout)
                        }
                    }
                    Text("After this, new activity syncs on its own in the background.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                } header: {
                    StepHeader(number: 3, title: "Sync", done: synced)
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

/// "1. Pair with your Mac" with a done mark once the step is finished.
private struct StepHeader: View {
    let number: Int
    let title: String
    let done: Bool

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: done ? "checkmark.circle.fill" : "\(number).circle")
                .foregroundStyle(done ? .green : .secondary)
            Text("\(number). \(title)")
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Step \(number) of 3, \(title)\(done ? ", done" : "")")
    }
}
