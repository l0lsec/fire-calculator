// The pairing (id + key) lives in the Keychain, shared with the background
// extension through the app group, and never leaves this device unencrypted.
import Foundation
import Security

enum AppGroup {
    static let id = "group.com.showupshowout.fireplanner"
    static var defaults: UserDefaults { UserDefaults(suiteName: id) ?? .standard }
}

enum PairingStore {
    private static let service = "com.showupshowout.fireplanner.pairing"
    private static let account = "current"

    private static var baseQuery: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecAttrAccessGroup as String: AppGroup.id,
        ]
    }

    static func load() -> Pairing? {
        var query = baseQuery
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: AnyObject?
        guard SecItemCopyMatching(query as CFDictionary, &out) == errSecSuccess,
              let data = out as? Data,
              let code = String(data: data, encoding: .utf8)
        else { return nil }
        return Pairing(code: code)
    }

    /// Stores the pairing code itself (it carries both the id and the key).
    static func save(code: String) throws {
        guard Pairing(code: code) != nil else { throw SyncError.notPaired }
        SecItemDelete(baseQuery as CFDictionary)
        var item = baseQuery
        item[kSecValueData as String] = Data(code.trimmingCharacters(in: .whitespacesAndNewlines).utf8)
        // Readable by the background extension while the phone is locked after first unlock.
        item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let status = SecItemAdd(item as CFDictionary, nil)
        guard status == errSecSuccess else { throw NSError(domain: NSOSStatusErrorDomain, code: Int(status)) }
    }

    static func clear() {
        SecItemDelete(baseQuery as CFDictionary)
    }
}
