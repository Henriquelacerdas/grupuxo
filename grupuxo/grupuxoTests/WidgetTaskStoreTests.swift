import Foundation
import Testing
@testable import grupuxo

struct WidgetTaskStoreTests {

    private func makeIsolatedStore() throws -> (WidgetTaskStore, URL) {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("widget-tests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let store = WidgetTaskStore(directoryURL: dir, suiteName: "test.\(UUID().uuidString)")
        return (store, dir)
    }

    @Test func savesLoadsAndOptimisticallyRemovesTasks() throws {
        let (store, dir) = try makeIsolatedStore()
        defer { try? FileManager.default.removeItem(at: dir) }

        #expect(store.loadSnapshot().status == .notSignedIn)

        let firstID = UUID()
        let secondID = UUID()
        let tasks = [
            WidgetTaskItem(
                occurrenceID: firstID,
                taskDefinitionID: UUID(),
                name: "Lavar a louça",
                roomName: "Cozinha",
                dueAt: Date(timeIntervalSince1970: 1_800_000_000),
                colorRawValue: "orange"
            ),
            WidgetTaskItem(
                occurrenceID: secondID,
                taskDefinitionID: UUID(),
                name: "Tirar o lixo",
                roomName: "Área de serviço",
                dueAt: nil,
                colorRawValue: "teal"
            ),
        ]

        store.saveReady(houseName: "Nossa Casa", tasks: tasks, reloadWidgets: false)
        let loaded = store.loadSnapshot()
        #expect(loaded.status == .ready)
        #expect(loaded.houseName == "Nossa Casa")
        #expect(loaded.tasks == tasks)

        let backup = store.removeTaskOptimistically(occurrenceID: firstID, reloadWidgets: false)
        #expect(backup?.tasks.count == 2)
        #expect(store.loadSnapshot().tasks.map(\.occurrenceID) == [secondID])

        if let backup {
            store.restoreSnapshot(backup, reloadWidgets: false)
        }
        #expect(store.loadSnapshot().tasks.count == 2)
    }

    @Test func clearRemovesSnapshotAndCredentialsOnLogout() throws {
        let (store, dir) = try makeIsolatedStore()
        defer { try? FileManager.default.removeItem(at: dir) }

        store.saveReady(houseName: "Nossa Casa", tasks: [], reloadWidgets: false)
        store.saveCredentials(baseURL: URL(string: "https://example.com")!, accessToken: "segredo")
        #expect(store.loadCredentials()?.accessToken == "segredo")

        store.clear(reloadWidgets: false)
        #expect(store.loadSnapshot().status == .notSignedIn)
        #expect(store.loadCredentials() == nil)
    }
}

