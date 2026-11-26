import BackgroundTasks
import FinanceKit
import SwiftUI
import UIKit

@main
struct FIREPlannerSyncApp: App {
    static let refreshTaskID = "com.showupshowout.fireplanner.refresh"
    @Environment(\.scenePhase) private var scenePhase
    @State private var model = SyncModel()

    init() {
        // Fallback refresh for iOS versions without FinanceKit background delivery.
        BGTaskScheduler.shared.register(forTaskWithIdentifier: Self.refreshTaskID, using: nil) { task in
            Self.scheduleRefresh()
            let work = Task {
                await SyncEngine.run(deviceName: nil)
                task.setTaskCompleted(success: true)
            }
            task.expirationHandler = { work.cancel() }
        }
    }

    static func scheduleRefresh() {
        let request = BGAppRefreshTaskRequest(identifier: refreshTaskID)
        request.earliestBeginDate = Date(timeIntervalSinceNow: 4 * 3600)
        try? BGTaskScheduler.shared.submit(request)
    }

    var body: some Scene {
        WindowGroup {
            ContentView(model: model)
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active {
                Task { await model.foregroundSync() }
            } else if phase == .background {
                Self.scheduleRefresh()
            }
        }
    }
}

@MainActor
@Observable
final class SyncModel {
    var pairing: Pairing? = PairingStore.load()
    var authorization: AuthorizationStatus?
    var last: SyncResult? = SyncEngine.lastResult
    var busy = false
    var message: String?

    var deviceName: String { UIDevice.current.name }

    func refreshStatus() async {
        pairing = PairingStore.load()
        authorization = try? await FinanceStore.shared.authorizationStatus()
        last = SyncEngine.lastResult
    }

    func pasteCode() {
        guard let text = UIPasteboard.general.string, Pairing(code: text) != nil else {
            message = "The clipboard does not hold a FIRE Planner pairing code. Copy it on the Mac first."
            return
        }
        do {
            try PairingStore.save(code: text)
            pairing = PairingStore.load()
            message = "Paired with your Mac."
        } catch {
            message = "Could not save the pairing: \(error.localizedDescription)"
        }
    }

    func unpair() {
        PairingStore.clear()
        pairing = nil
        message = "Unpaired. Nothing more is sent to the Mac."
    }

    func allowWalletAccess() async {
        guard FinanceStore.isDataAvailable(.financialData) else {
            message = SyncError.unavailable.localizedDescription
            return
        }
        do {
            authorization = try await FinanceStore.shared.requestAuthorization()
            if authorization == .authorized {
                enableBackgroundDelivery()
                await syncNow()
            }
        } catch {
            message = "Wallet access failed: \(error.localizedDescription)"
        }
    }

    func enableBackgroundDelivery() {
        if #available(iOS 26.0, *) {
            FinanceStore.shared.enableBackgroundDelivery(for: [.transactions, .accountBalances], frequency: .hourly)
        }
    }

    func syncNow() async {
        busy = true
        defer { busy = false }
        CloudDrop.flushOutbox()
        last = await SyncEngine.run(deviceName: deviceName)
        message = last?.error == nil ? "Synced. Your Mac picks it up the next time you open FIRE Planner." : nil
    }

    func foregroundSync() async {
        await refreshStatus()
        CloudDrop.flushOutbox()
        guard pairing != nil, authorization == .authorized else { return }
        enableBackgroundDelivery()
        // Avoid re-syncing on every app switch.
        if let l = last, l.error == nil, Date().timeIntervalSince(l.finishedAt) < 600 { return }
        await syncNow()
    }
}
