// Cross-language check (macOS): seal a sample snapshot with the iPhone app's
// own format code, so the Mac importer can prove it opens and parses it.
// Usage: format-check <pairing code> <output file>
import Foundation

let args = CommandLine.arguments
guard args.count == 3, let pairing = Pairing(code: args[1]) else {
    FileHandle.standardError.write(Data("usage: format-check <pairing code> <out>\n".utf8))
    exit(2)
}
let day = Formats.day(Date(timeIntervalSince1970: 1_790_000_000))
let snapshot = SnapshotDTO(
    v: SyncFormat.version,
    generatedAt: Formats.instant(Date()),
    deviceName: nil,
    accounts: [
        AccountDTO(id: "6f1c2c1e-2f43-4a8f-9a55-0c1f5d7f0a11", kind: "liability", displayName: "Apple Card",
                   description: nil, institution: "Apple", currency: "USD",
                   credit: .init(limit: Formats.decimal(Decimal(string: "10000")!), minimumNext: nil,
                                 nextDue: day, overdue: nil)),
    ],
    balances: [
        BalanceDTO(accountId: "6f1c2c1e-2f43-4a8f-9a55-0c1f5d7f0a11", kind: "booked",
                   amount: Formats.decimal(Decimal(string: "812.5")!), indicator: "debit",
                   asOf: Formats.instant(Date())),
    ],
    transactions: [
        TransactionDTO(id: "0a6d3f0e-8d7c-4b8e-9f00-3a4b5c6d7e8f", accountId: "6f1c2c1e-2f43-4a8f-9a55-0c1f5d7f0a11",
                       amount: Formats.decimal(Decimal(string: "12.3456789")!), indicator: "debit",
                       description: "BLUE BOTTLE", merchant: nil, mcc: 5814, type: "pointOfSale",
                       status: "booked", date: day, posted: nil, currency: "USD"),
    ]
)
let file = try SyncCrypto.seal(JSONEncoder().encode(snapshot), pairing: pairing)
_ = try SyncCrypto.open(file, pairing: pairing) // the phone side can open its own file
try file.write(to: URL(fileURLWithPath: args[2]))
print("SEALED \(file.count) bytes")
