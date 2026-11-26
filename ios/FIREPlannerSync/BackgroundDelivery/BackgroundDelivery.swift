// FinanceKit wakes this extension when Apple Card, Apple Cash or Savings
// activity changes (iOS 26+), so new transactions reach the Mac without
// opening the app.
import ExtensionFoundation
import FinanceKit

@main
final class FIREPlannerBackgroundDelivery: BackgroundDeliveryExtension {
    required init() {}

    func didReceiveData(for types: [FinanceStore.BackgroundDataType]) async {
        await SyncEngine.run(deviceName: nil)
    }

    func willTerminate() async {}
}
