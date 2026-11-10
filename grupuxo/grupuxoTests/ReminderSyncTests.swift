import Foundation
import Testing
@testable import grupuxo

struct ReminderSyncTests {

    @Test func linkRoundTripsTheOccurrenceID() throws {
        let id = UUID()
        let url = try #require(ReminderLink.url(for: id))
        #expect(ReminderLink.occurrenceID(from: url) == id)
    }

    @Test func foreignURLsAreNotLinks() {
        #expect(ReminderLink.occurrenceID(from: URL(string: "https://example.com/\(UUID().uuidString)")) == nil)
        #expect(ReminderLink.occurrenceID(from: URL(string: "grupuxo://occurrence/not-a-uuid")) == nil)
        #expect(ReminderLink.occurrenceID(from: nil) == nil)
    }

    @Test func preferenceIsOffByDefaultAndPersists() throws {
        let suite = "ReminderSyncTests.\(UUID().uuidString)"
        let defaults = try #require(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }

        let preference = ReminderSyncPreference(defaults: defaults)
        #expect(!preference.isEnabled)
        preference.setEnabled(true)
        #expect(ReminderSyncPreference(defaults: defaults).isEnabled)
        preference.setEnabled(false)
        #expect(!preference.isEnabled)
    }
}
