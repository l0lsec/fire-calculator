// Reads Apple Card, Apple Cash and Savings through FinanceKit, builds a full
// snapshot, encrypts it, and drops it in the app's iCloud Drive folder where
// the Mac picks it up. Used by the app and by the background extension.
import FinanceKit
import Foundation

struct SyncResult: Codable, Equatable {
    let finishedAt: Date
    let accounts: Int
    let transactions: Int
    let error: String?
}

enum SyncEngine {
    static let iCloudContainer = "iCloud.com.showupshowout.fireplanner"
    private static let lastResultKey = "lastSyncResult"

    static var lastResult: SyncResult? {
        guard let data = AppGroup.defaults.data(forKey: lastResultKey) else { return nil }
        return try? JSONDecoder().decode(SyncResult.self, from: data)
    }

    private static func record(_ r: SyncResult) {
        if let data = try? JSONEncoder().encode(r) { AppGroup.defaults.set(data, forKey: lastResultKey) }
    }

    /// One full sync. Never throws: the outcome is recorded for the UI.
    @discardableResult
    static func run(deviceName: String?) async -> SyncResult {
        // The extension has no UIDevice name; reuse the one the app last saw.
        if let deviceName { AppGroup.defaults.set(deviceName, forKey: "deviceName") }
        let name = deviceName ?? AppGroup.defaults.string(forKey: "deviceName")
        do {
            let (snapshot, counts) = try await buildSnapshot(deviceName: name)
            guard let pairing = PairingStore.load() else { throw SyncError.notPaired }
            let plaintext = try JSONEncoder().encode(snapshot)
            let file = try SyncCrypto.seal(plaintext, pairing: pairing)
            try CloudDrop.write(file, name: "\(pairing.pairingID).\(SyncFormat.fileExtension)")
            let r = SyncResult(finishedAt: Date(), accounts: counts.0, transactions: counts.1, error: nil)
            record(r)
            return r
        } catch {
            let r = SyncResult(finishedAt: Date(), accounts: 0, transactions: 0, error: error.localizedDescription)
            record(r)
            return r
        }
    }

    static func buildSnapshot(deviceName: String?) async throws -> (SnapshotDTO, (Int, Int)) {
        guard FinanceStore.isDataAvailable(.financialData) else { throw SyncError.unavailable }
        let store = FinanceStore.shared
        guard try await store.authorizationStatus() == .authorized else { throw SyncError.notAuthorized }

        let accounts = try await store.accounts(query: AccountQuery())
        let balances = try await store.accountBalances(query: AccountBalanceQuery(
            sortDescriptors: [SortDescriptor(\.id)]
        ))
        let transactions = try await store.transactions(query: TransactionQuery(
            sortDescriptors: [SortDescriptor(\.transactionDate, order: .reverse)]
        ))

        let accountDTOs = accounts.map(account)
        let balanceDTOs = balances.flatMap(balance)
        let known = Set(accounts.map(\.id))
        let txDTOs = transactions.filter { known.contains($0.accountID) }.map(transaction)
        let snapshot = SnapshotDTO(
            v: SyncFormat.version,
            generatedAt: Formats.instant(Date()),
            deviceName: deviceName,
            accounts: accountDTOs,
            balances: balanceDTOs,
            transactions: txDTOs
        )
        return (snapshot, (accountDTOs.count, txDTOs.count))
    }

    // MARK: - FinanceKit -> DTO

    static func account(_ a: Account) -> AccountDTO {
        var credit: AccountDTO.Credit?
        if let l = a.liabilityAccount {
            let c = l.creditInformation
            credit = .init(
                limit: c.creditLimit.map { Formats.decimal($0.amount) },
                minimumNext: c.minimumNextPaymentAmount.map { Formats.decimal($0.amount) },
                nextDue: c.nextPaymentDueDate.map(Formats.day),
                overdue: c.overduePaymentAmount.map { Formats.decimal($0.amount) }
            )
        }
        return AccountDTO(
            id: a.id.uuidString.lowercased(),
            kind: a.liabilityAccount != nil ? "liability" : "asset",
            displayName: a.displayName,
            description: a.accountDescription,
            institution: a.institutionName,
            currency: a.currencyCode,
            credit: credit
        )
    }

    static func balance(_ b: AccountBalance) -> [BalanceDTO] {
        func dto(_ kind: String, _ x: Balance) -> BalanceDTO {
            BalanceDTO(
                accountId: b.accountID.uuidString.lowercased(),
                kind: kind,
                amount: Formats.decimal(abs(x.amount.amount)),
                indicator: x.creditDebitIndicator == .credit ? "credit" : "debit",
                asOf: Formats.instant(x.asOfDate)
            )
        }
        switch b.currentBalance {
        case let .available(x): return [dto("available", x)]
        case let .booked(x): return [dto("booked", x)]
        case let .availableAndBooked(available, booked): return [dto("booked", booked), dto("available", available)]
        @unknown default: return []
        }
    }

    static func transaction(_ t: Transaction) -> TransactionDTO {
        TransactionDTO(
            id: t.id.uuidString.lowercased(),
            accountId: t.accountID.uuidString.lowercased(),
            amount: Formats.decimal(abs(t.transactionAmount.amount)),
            indicator: t.creditDebitIndicator == .credit ? "credit" : "debit",
            description: String(t.transactionDescription.prefix(500)),
            merchant: t.merchantName.map { String($0.prefix(200)) },
            mcc: t.merchantCategoryCode.map { Int($0.rawValue) },
            type: String(describing: t.transactionType),
            status: String(describing: t.status),
            date: Formats.day(t.transactionDate),
            posted: t.postedDate.map(Formats.day),
            currency: t.transactionAmount.currencyCode
        )
    }
}

/// Writes the encrypted file into the app's iCloud Drive container. If iCloud
/// is unreachable (common inside the background extension), the file waits in
/// the app group's outbox and the app moves it the next time it runs.
enum CloudDrop {
    static func containerDocuments() -> URL? {
        FileManager.default.url(forUbiquityContainerIdentifier: SyncEngine.iCloudContainer)?
            .appendingPathComponent("Documents", isDirectory: true)
    }

    static var outbox: URL? {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: AppGroup.id)?
            .appendingPathComponent("Outbox", isDirectory: true)
    }

    static func write(_ data: Data, name: String) throws {
        if let docs = containerDocuments() {
            try FileManager.default.createDirectory(at: docs, withIntermediateDirectories: true)
            try coordinatedWrite(data, to: docs.appendingPathComponent(name))
            return
        }
        guard let out = outbox else { throw SyncError.noDestination }
        try FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)
        try data.write(to: out.appendingPathComponent(name), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }

    /// Move anything the extension left in the outbox into iCloud Drive.
    static func flushOutbox() {
        guard let out = outbox, let docs = containerDocuments(),
              let files = try? FileManager.default.contentsOfDirectory(at: out, includingPropertiesForKeys: nil)
        else { return }
        try? FileManager.default.createDirectory(at: docs, withIntermediateDirectories: true)
        for f in files where f.pathExtension == SyncFormat.fileExtension {
            if let data = try? Data(contentsOf: f) {
                try? coordinatedWrite(data, to: docs.appendingPathComponent(f.lastPathComponent))
                try? FileManager.default.removeItem(at: f)
            }
        }
    }

    private static func coordinatedWrite(_ data: Data, to url: URL) throws {
        var coordError: NSError?
        var writeError: Error?
        NSFileCoordinator().coordinate(writingItemAt: url, options: .forReplacing, error: &coordError) { target in
            do { try data.write(to: target, options: .atomic) } catch { writeError = error }
        }
        if let e = coordError ?? writeError { throw e }
    }
}
