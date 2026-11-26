// The sync file format, version 1. Must match apps/web/src/server/financekit/format.ts.
//
// File: {"v":1,"pid":"<16 hex pairing id>","box":"<base64 of nonce || ciphertext || tag>"}
// The box is AES-256-GCM over the JSON snapshot below, with the AAD
// "fireplanner-financekit:v1:<pid>". The 32-byte key comes from the Mac in the
// pairing code "fp1.<pid>.<base64url key>".
import CryptoKit
import Foundation
#if os(iOS)
import FinanceKit
#endif

enum SyncFormat {
    static let version = 1
    static let fileExtension = "fpsync"

    static func aad(_ pairingID: String) -> Data {
        Data("fireplanner-financekit:v1:\(pairingID)".utf8)
    }
}

struct Pairing: Equatable {
    let pairingID: String
    let key: Data

    /// Parses "fp1.<16 hex>.<43 base64url chars>"; nil for anything else.
    init?(code: String) {
        let parts = code.trimmingCharacters(in: .whitespacesAndNewlines).split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count == 3, parts[0] == "fp1" else { return nil }
        let pid = String(parts[1])
        guard pid.count == 16, pid.allSatisfy({ $0.isHexDigit && !$0.isUppercase }) else { return nil }
        var b64 = String(parts[2]).replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        guard b64.count == 43 else { return nil }
        b64 += "="
        guard let key = Data(base64Encoded: b64), key.count == 32 else { return nil }
        self.pairingID = pid
        self.key = key
    }

    init(pairingID: String, key: Data) {
        self.pairingID = pairingID
        self.key = key
    }
}

struct Envelope: Codable {
    let v: Int
    let pid: String
    let box: String
}

enum SyncCrypto {
    static func seal(_ plaintext: Data, pairing: Pairing) throws -> Data {
        let box = try AES.GCM.seal(
            plaintext,
            using: SymmetricKey(data: pairing.key),
            authenticating: SyncFormat.aad(pairing.pairingID)
        )
        guard let combined = box.combined else { throw SyncError.encryption }
        let envelope = Envelope(v: SyncFormat.version, pid: pairing.pairingID, box: combined.base64EncodedString())
        return try JSONEncoder().encode(envelope)
    }

    /// Used by the self-test only: the Mac is the one that opens files.
    static func open(_ file: Data, pairing: Pairing) throws -> Data {
        let envelope = try JSONDecoder().decode(Envelope.self, from: file)
        guard envelope.pid == pairing.pairingID, let combined = Data(base64Encoded: envelope.box) else {
            throw SyncError.encryption
        }
        return try AES.GCM.open(
            AES.GCM.SealedBox(combined: combined),
            using: SymmetricKey(data: pairing.key),
            authenticating: SyncFormat.aad(pairing.pairingID)
        )
    }
}

// MARK: - Snapshot (plaintext inside the box)

struct SnapshotDTO: Codable {
    let v: Int
    let generatedAt: String
    let deviceName: String?
    let accounts: [AccountDTO]
    let balances: [BalanceDTO]
    let transactions: [TransactionDTO]
}

struct AccountDTO: Codable {
    struct Credit: Codable {
        let limit: String?
        let minimumNext: String?
        let nextDue: String?
        let overdue: String?
    }

    let id: String
    let kind: String // "asset" | "liability"
    let displayName: String
    let description: String?
    let institution: String
    let currency: String
    let credit: Credit?
}

struct BalanceDTO: Codable {
    let accountId: String
    let kind: String // "booked" | "available"
    let amount: String
    let indicator: String // "credit" | "debit"
    let asOf: String
}

struct TransactionDTO: Codable {
    let id: String
    let accountId: String
    let amount: String // non-negative; direction is the indicator
    let indicator: String
    let description: String
    let merchant: String?
    let mcc: Int?
    let type: String
    let status: String
    let date: String
    let posted: String?
    let currency: String
}

enum SyncError: LocalizedError {
    case notPaired
    case notAuthorized
    case unavailable
    case encryption
    case noDestination

    var errorDescription: String? {
        switch self {
        case .notPaired: "Not paired with the Mac yet."
        case .notAuthorized: "Wallet access has not been allowed."
        case .unavailable: "Wallet financial data is not available on this device."
        case .encryption: "Could not encrypt the sync file."
        case .noDestination: "iCloud Drive is not available. Sign in to iCloud and turn on iCloud Drive."
        }
    }
}

#if os(iOS)
enum FinanceAccess {
    /// FinanceKit traps (it does not throw) when the process lacks the entitlement,
    /// and the Simulator has no Wallet data and cannot carry the entitlement.
    static var available: Bool {
        #if targetEnvironment(simulator)
        return false
        #else
        return FinanceStore.isDataAvailable(.financialData)
        #endif
    }
}

#endif

enum Formats {
    /// Locale-independent decimal string, at most 4 fractional digits.
    static func decimal(_ d: Decimal) -> String {
        var value = d
        var rounded = Decimal()
        NSDecimalRound(&rounded, &value, 4, .plain)
        return NSDecimalNumber(decimal: rounded).stringValue
    }

    static func day(_ date: Date) -> String {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = .current
        f.dateFormat = "yyyy-MM-dd"
        return f.string(from: date)
    }

    static func instant(_ date: Date) -> String {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f.string(from: date)
    }
}
